import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('入职任务完成后只能建档一次，不创建小程序账号', async () => {
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
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'x', 'HR', 'hr_admin', 1, NOW())`);
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const token = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hrToken = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const request = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    assert.equal((await request('/onboarding/fields', 'PUT', ['姓名', '电话'])).status, 200);
    const createdRecord = await request('/onboarding', 'POST', { 姓名: '新人', 电话: '13800000000' });
    assert.equal(createdRecord.status, 200);
    const id = createdRecord.body.data.id;
    const forbidden = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr/onboarding/${id}/tasks`, { headers: { Authorization: `Bearer ${hrToken}` } });
    assert.equal(forbidden.status, 403);
    assert.equal((await request(`/onboarding/${id}/tasks`, 'POST', { title: '   ', required: true })).status, 400);
    const task = await request(`/onboarding/${id}/tasks`, 'POST', { title: '签署合同', required: true });
    assert.equal(task.status, 200);
    const optional = await request(`/onboarding/${id}/tasks`, 'POST', { title: '完成培训', required: false });
    assert.equal(optional.status, 200);
    const employee = { name: '新人', pinyin: 'xinren', employeeNo: 'TEST-HR-1', phone: '13800000000', joinDate: '2026-10-31', jobCategory: '员工' };
    assert.equal((await request(`/onboarding/${id}/confirm`, 'POST', employee)).status, 400);
    assert.equal((await request(`/onboarding/${id}/tasks/${task.body.data.id}`, 'PATCH', { completed: true })).status, 200);
    assert.equal((await request('/onboarding')).body.data[0].taskStatus, 'in_progress');
    const responses = await Promise.all([request(`/onboarding/${id}/confirm`, 'POST', employee), request(`/onboarding/${id}/confirm`, 'POST', employee)]);
    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.equal((await request(`/onboarding/${id}/tasks/${optional.body.data.id}`, 'PATCH', { completed: true })).status, 200);
    assert.equal((await request('/onboarding')).body.data[0].taskStatus, 'completed');
    assert.equal((await request(`/onboarding/${id}/tasks`, 'POST', { title: '后续任务', required: false })).status, 200);
    assert.equal((await request('/onboarding')).body.data[0].taskStatus, 'in_progress');
    assert.equal((await request('/onboarding')).body.data[0].employeeId !== null, true);
    const [employees] = await conn.query(`SELECT id FROM \`${database}\`.employees WHERE employee_no = ?`, ['TEST-HR-1']);
    assert.equal((employees as unknown[]).length, 1);
    const [accounts] = await conn.query(`SELECT a.employee_id FROM \`${database}\`.employee_accounts a JOIN \`${database}\`.employees e ON a.employee_id=e.id WHERE e.employee_no = ?`, ['TEST-HR-1']);
    assert.equal((accounts as unknown[]).length, 0);
    const second = await request('/onboarding', 'POST', { 姓名: '新人二', 电话: '13800000001' });
    const third = await request('/onboarding', 'POST', { 姓名: '新人三', 电话: '13800000002' });
    const simultaneous = await Promise.all([
      request(`/onboarding/${second.body.data.id}/confirm`, 'POST', { ...employee, name: '新人二', pinyin: 'xinren', employeeNo: 'TEST-HR-2' }),
      request(`/onboarding/${third.body.data.id}/confirm`, 'POST', { ...employee, name: '新人三', pinyin: 'xinren', employeeNo: 'TEST-HR-3' }),
    ]);
    assert.deepEqual(simultaneous.map((r) => r.status), [200, 200]);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
