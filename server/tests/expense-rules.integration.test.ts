import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('超级管理员可保存和重新读取报销审批规则，其他账号无权访问', async () => {
  const database = `yunqi_rules_test_${randomBytes(8).toString('hex')}`;
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
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'x', 'HR', 'hr_admin', 1, NOW())`);
    const { config } = await import('../src/config');
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/admin/expense-rules`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hr = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const employee = issueTokens('U001').accessToken;
    async function request(token: string, method = 'GET', body?: unknown) {
      const res = await fetch(base, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() as { data?: any; message?: string } };
    }
    assert.equal((await request(admin)).body.data.content, '');
    assert.equal((await request(hr)).status, 403);
    assert.equal((await request(hr, 'PUT', { content: '无权修改' })).status, 403);
    assert.equal((await request(employee, 'PUT', { content: '无权修改' })).status, 401);
    assert.equal((await request(admin, 'PUT', { content: 'a'.repeat(10001) })).status, 400);
    const content = '第一条：发票抬头应符合公司要求。\n第二条：请注明费用用途。';
    assert.equal((await request(admin, 'PUT', { content })).body.data.content, content);
    const reloaded = await request(admin);
    assert.equal(reloaded.body.data.content, content);
    assert.ok(reloaded.body.data.updatedAt);
    assert.equal((await request(admin, 'PUT', { content: '' })).body.data.content, '');
    assert.equal((await request(admin)).body.data.content, '');
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
