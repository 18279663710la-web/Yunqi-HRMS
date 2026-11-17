import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('停用员工后立即撤销访问和刷新令牌，重新启用不能恢复旧令牌', async () => {
  const database = `yunqi_auth_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema(); await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' }); const original = issueTokens('U001');
    const request = async (path: string, token: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    assert.equal((await request('/me', original.accessToken)).status, 200);
    assert.equal((await request('/admin/employees/U001/account/status', admin, 'PATCH', { status: 'disabled' })).status, 200);
    assert.equal((await request('/me', original.accessToken)).status, 401);
    assert.equal((await request('/auth/refresh', '', 'POST', { refreshToken: original.refreshToken })).status, 401);
    assert.equal((await request('/admin/employees/U001/account/status', admin, 'PATCH', { status: 'active' })).status, 200);
    assert.equal((await request('/me', original.accessToken)).status, 401);
    assert.equal((await request('/auth/refresh', '', 'POST', { refreshToken: original.refreshToken })).status, 401);
    const [rows] = await conn.query<any[]>(`SELECT login_name FROM \`${database}\`.employee_accounts WHERE employee_id='U001'`);
    const login = await request('/auth/password-login', '', 'POST', { loginName: rows[0].login_name, password: config.demoEmployeePassword });
    assert.equal(login.status, 200); assert.equal((await request('/me', login.body.data.accessToken)).status, 200);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
