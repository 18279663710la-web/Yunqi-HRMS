import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('人事异动生效、撤销及并发保护', async () => {
  const database = `yunqi_hr_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool;
    await pool.ensureSchema(); await (await import('../src/shared/db/seed')).seedDemoData();
    await (await import('../src/admin/employees/adminEmployeeService')).backfillEmployeeJobCategories();
    const titles = await import('../src/domains/employees/jobTitleService'); await titles.backfillJobTitles(); await titles.createJobTitle('测试岗位');
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'x', 'HR', 'hr_admin', 1, NOW())`);
    const { config } = await import('../src/config'); const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve)); closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const token = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hrToken = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const request = async (path: string, method = 'GET', body?: unknown, auth = token) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    const input = { employeeId: 'U001', type: 'transfer', effectiveDate: '2026-01-01', changes: { position: '测试岗位', level: 'P9' }, note: '' };
    const [original] = await conn.query<any[]>(`SELECT position, level FROM \`${database}\`.employees WHERE id='U001'`);
    assert.equal((await request('/employee-transitions', 'POST', input, hrToken)).status, 403);
    assert.equal((await request('/employee-transitions', 'POST', { ...input, effectiveDate: '2099-01-01' })).status, 400);
    assert.equal((await request('/employee-transitions', 'POST', { ...input, changes: {} })).status, 400);
    const first = await request('/employee-transitions', 'POST', input); assert.equal(first.status, 200);
    const [changed] = await conn.query<any[]>(`SELECT position, level FROM \`${database}\`.employees WHERE id='U001'`);
    assert.equal(changed[0].position, '测试岗位'); assert.equal(changed[0].level, 'P9');
    const second = await request('/employee-transitions', 'POST', { ...input, type: 'promotion', changes: { level: 'P10' } }); assert.equal(second.status, 200);
    assert.equal((await request(`/employee-transitions/${first.body.data.id}/cancel`, 'POST', {})).status, 400);
    assert.equal((await request(`/employee-transitions/${second.body.data.id}/cancel`, 'POST', {})).status, 200);
    assert.equal((await request(`/employee-transitions/${first.body.data.id}/cancel`, 'POST', {})).status, 200);
    const [restored] = await conn.query<any[]>(`SELECT position, level FROM \`${database}\`.employees WHERE id='U001'`);
    assert.equal(restored[0].position, original[0].position); assert.equal(restored[0].level, original[0].level);
    const history = await request('/employee-transitions?employeeId=U001'); assert.equal(history.body.data.length, 2); assert.equal(history.body.data[0].status, 'cancelled');
    const third = await request('/employee-transitions', 'POST', input); assert.equal(third.status, 200);
    await conn.query(`UPDATE \`${database}\`.employees SET level='P7' WHERE id='U001'`);
    assert.equal((await request(`/employee-transitions/${third.body.data.id}/cancel`, 'POST', {})).status, 400);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
