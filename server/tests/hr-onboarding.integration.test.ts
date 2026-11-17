import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('历史入职申请只读，旧写入接口已移除', async () => {
  const database = `yunqi_hr_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool;
    await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'x', 'HR', 'hr_admin', 1, NOW())`);
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const token = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hrToken = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const request = async (path: string, method = 'GET', body?: unknown, auth = token) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any; message?: string } };
    };
    await conn.query(`INSERT INTO \`${database}\`.hr_onboarding (fields_json, created_at) VALUES (?, NOW())`, [JSON.stringify({ 姓名: '历史申请人' })]);
    assert.equal((await request('/onboarding', 'GET', undefined, hrToken)).status, 403);
    const listed = await request('/onboarding');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data[0].fields.姓名, '历史申请人');
    assert.equal((await request('/onboarding/fields', 'PUT', ['姓名', '电话'])).status, 404);
    assert.equal((await request('/onboarding', 'POST', { 姓名: '新人', 电话: '13800000000' })).status, 404);
    assert.equal((await request('/onboarding/1/tasks', 'POST', { title: '签署合同', required: true })).status, 404);
    assert.equal((await request('/onboarding/1/confirm', 'POST', { name: '新人' })).status, 404);
    assert.equal((await request('/onboarding/task-template', 'PUT', [{ title: '签署合同', required: true }])).status, 404);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
