import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('审批流程设计稿独立按类型保存，验证权限、节点和版本，不改变现有审批配置', async () => {
  const database = `yunqi_workflow_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username,password_hash,name,role,status,created_at) VALUES ('hr_test','x','HR','hr_admin',1,NOW())`);
    const { config } = await import('../src/config');
    const adminRow = await pool.queryOne<{ id: number }>("SELECT id FROM admins WHERE role='super_admin' LIMIT 1"); assert.ok(adminRow);
    const hrRow = await pool.queryOne<{ id: number }>("SELECT id FROM admins WHERE username='hr_test'"); assert.ok(hrRow);
    const admin = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String(adminRow.id) });
    const hr = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String(hrRow.id) });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const request = async (path: string, method = 'GET', body?: unknown, token = admin) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/approval-workflows/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    const [before] = await conn.query(`SELECT * FROM \`${database}\`.approval_approvers ORDER BY type`);
    assert.equal((await request('expense', 'GET', undefined, hr)).status, 403);
    assert.equal((await request('expense', 'PUT', { version: 0, nodes: [], edges: [] }, hr)).status, 403);
    assert.equal((await request('expense')).body.data.version, 0);
    const graph = { version: 0, nodes: [{ id: 'form', kind: 'form', position: { x: 50, y: 80 } }, { id: 'review', kind: 'approver', position: { x: 320, y: 80 } }], edges: [{ id: 'edge', source: 'form', target: 'review' }] };
    const saved = await request('expense', 'PUT', graph); assert.equal(saved.status, 200); assert.equal(saved.body.data.version, 1);
    assert.deepEqual((await request('expense')).body.data.nodes, graph.nodes);
    assert.equal((await request('expense', 'PUT', graph)).status, 409);
    assert.equal((await request('leave')).body.data.version, 0);
    assert.equal((await request('expense', 'PUT', { ...graph, version: 1, edges: [{ id: 'bad', source: 'form', target: 'missing' }] })).status, 400);
    assert.equal((await request('expense', 'PUT', { ...graph, version: 1, edges: [{ id: 'bad', source: 'form', target: 'form' }] })).status, 400);
    const raceGraph = { ...graph, version: 1 };
    const race = await Promise.all([request('expense', 'PUT', raceGraph), request('expense', 'PUT', raceGraph)]);
    assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
    assert.equal((await request('expense')).body.data.version, 2);
    assert.equal((await request('unknown')).status, 400);
    const [after] = await conn.query(`SELECT * FROM \`${database}\`.approval_approvers ORDER BY type`);
    assert.deepEqual(after, before);
  } finally {
    if (closeServer) await closeServer(); if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end();
  }
});
