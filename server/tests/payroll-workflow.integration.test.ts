import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('薪资发放流程保存节点、连线和版本冲突', async () => {
  const database = `yunqi_payroll_workflow_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    await pool.execute("INSERT INTO admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'unused', '测试', 'hr_admin', 1, NOW())");
    const hrAdmin = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const call = async (method = 'GET', body?: unknown, token = admin) => {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/admin/hr/payroll-workflow`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, data: (await res.json() as { data?: any }).data };
    };
    const node = (id: string, kind = 'system-calc') => ({ id, type: 'payroll', position: { x: 100, y: 100 }, data: { kind } });
    const edge = (id: string, source: string, target: string) => ({ id, source, target });
    const nodes = [node('n1', 'system-calc'), node('n2', 'review')];
    const edges = [edge('e1', 'n1', 'n2')];

    assert.deepEqual((await call()).data, { version: 1, nodes: [], edges: [] });
    assert.equal((await call('GET', undefined, hrAdmin)).status, 403);
    assert.equal((await call('PUT', { version: 1, nodes, edges }, hrAdmin)).status, 403);
    assert.equal((await call('GET', undefined, '')).status, 401);

    const made = await call('PUT', { version: 1, nodes, edges });
    assert.equal(made.status, 200);
    assert.equal(made.data.version, 2);
    assert.deepEqual(made.data.nodes, nodes);
    assert.deepEqual(made.data.edges, edges);
    assert.deepEqual((await call()).data, made.data);

    assert.equal((await call('PUT', { version: 1, nodes, edges })).status, 409);
    assert.equal((await call('PUT', { version: 2, nodes: [{ ...node('bad'), data: { kind: 'unknown' } }], edges: [] })).status, 400);
    assert.equal((await call('PUT', { version: 2, nodes: [node('same'), node('same')], edges: [] })).status, 400);
    assert.equal((await call('PUT', { version: 2, nodes: [node('n1')], edges: [edge('e1', 'n1', 'missing')] })).status, 400);
    assert.equal((await call('PUT', { version: 2, nodes: [node('n1')], edges: [edge('e1', 'n1', 'n1')] })).status, 400);
    assert.equal((await call('PUT', { version: 2, nodes, edges: [...edges, edge('e2', 'n1', 'n2')] })).status, 400);
    const tooMany = Array.from({ length: 201 }, (_, index) => node(`n${index + 1}`));
    assert.equal((await call('PUT', { version: 2, nodes: tooMany, edges: [] })).status, 400);

    const cleared = await call('PUT', { version: 2, nodes: [], edges: [] });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.version, 3);
    assert.deepEqual((await call()).data, { version: 3, nodes: [], edges: [] });

    const concurrent = await Promise.all([
      call('PUT', { version: 3, nodes: [node('c1')], edges: [] }),
      call('PUT', { version: 3, nodes: [node('c2')], edges: [] }),
    ]);
    assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409]);
    assert.equal((await call()).data.version, 4);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
