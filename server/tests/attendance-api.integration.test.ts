import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('考勤设置和打卡接口在独立数据库中验证时段、休息日、位置及权限', async (t) => {
  const database = `yunqi_att_test_${randomBytes(8).toString('hex')}`;
  assert.match(database, /^yunqi_att_test_[0-9a-f]{16}$/);
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '',
  });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.query(`CREATE TABLE \`${database}\`.attendance_settings (
      id INT PRIMARY KEY, start_time CHAR(5) NOT NULL, end_time CHAR(5) NOT NULL, address VARCHAR(255) NOT NULL,
      floor VARCHAR(50) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, radius INT NOT NULL
    )`);
    await connection.query(`INSERT INTO \`${database}\`.attendance_settings VALUES (1, '08:00', '17:00', '旧地点', '3楼', 23.1, 113.3, 100)`);
    process.env.MYSQL_DATABASE = database;
    const poolModule = await import('../src/shared/db/pool');
    closePool = poolModule.closePool;
    await poolModule.ensureSchema();
    const [oldRows] = await connection.query(`SELECT start_time, end_time, address, in_end_time, out_end_time FROM \`${database}\`.attendance_settings WHERE id=1`);
    const old = (oldRows as Array<{ start_time: string; end_time: string; address: string; in_end_time: string | null; out_end_time: string | null }>)[0];
    assert.deepEqual(old, { start_time: '08:00', end_time: '17:00', address: '旧地点', in_end_time: null, out_end_time: null });
    await connection.query(`DELETE FROM \`${database}\`.attendance_settings WHERE id=1`);
    const { seedDatabase } = await import('../src/shared/db/seed');
    await seedDatabase();
    const { ensureDefaultAdmin } = await import('../src/admin/admin-accounts/adminAuthService');
    await ensureDefaultAdmin();
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const { config } = await import('../src/config');
    const { createApp } = await import('../src/app');
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const employee = issueTokens('U001').accessToken;
    async function request(path: string, token: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, payload: await response.json() as { data?: any; message?: string } };
    }
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-27T17:30:00') });
    const position = { latitude: 23.1, longitude: 113.3, accuracy: 10 };
    const unconfigured = await request('/attendance/punch', employee, 'POST', { type: 'in', ...position });
    assert.equal(unconfigured.payload.data.ok, false);
    const settings = { startTime: '08:00', inEndTime: '10:00', endTime: '17:00', outEndTime: '18:30', restDates: ['2026-10-28'], address: '测试地点', floor: '3楼', latitude: 23.1, longitude: 113.3, radius: 100 };
    assert.equal((await request('/admin/attendance/settings', employee, 'PUT', settings)).status, 401);
    assert.equal((await request('/admin/attendance/settings', admin, 'PUT', { ...settings, radius: 0 })).status, 400);
    assert.equal((await request('/admin/attendance/settings', admin, 'PUT', settings)).status, 200);
    assert.equal((await request('/attendance/settings', employee)).payload.data.floor, '3楼');
    assert.equal((await request('/attendance/today', employee)).payload.data.workTime, '08:00 - 17:00');
    assert.equal((await request('/attendance/punch', employee, 'POST', { type: 'out' })).payload.data.ok, false);
    assert.equal((await request('/attendance/punch', employee, 'POST', { type: 'out', ...position, latitude: 23.11 })).payload.data.ok, false);
    assert.equal((await request('/attendance/punch', employee, 'POST', { type: 'in', ...position })).payload.data.ok, false);
    assert.equal((await request('/attendance/punch', employee, 'POST', { type: 'out', ...position })).payload.data.ok, true);
    assert.equal((await request('/attendance/today', employee)).payload.data.status, 'missing_in');
    assert.equal((await request('/admin/attendance?month=2026-10&employeeId=U001', admin)).payload.data.list.find((item: { date: string }) => item.date === '2026-10-27').status, 'missing_in');
    const monthly = await request('/admin/attendance?month=2026-10', admin);
    const daily = await request('/admin/attendance?date=2026-10-27', admin);
    assert.equal(daily.status, 200);
    assert.equal(daily.payload.data.startDate, '2026-10-27');
    assert.equal(daily.payload.data.endDate, '2026-10-27');
    assert.deepEqual(daily.payload.data.list, monthly.payload.data.list.filter((item: { date: string }) => item.date === '2026-10-27'));
    assert.equal(daily.payload.data.list.length, 6);
    assert.equal(daily.payload.data.summary.missingIn, daily.payload.data.list.filter((item: { status: string }) => item.status === 'missing_in').length);
    const filtered = await request('/admin/attendance?date=2026-10-27&employeeId=U001', admin);
    assert.equal(filtered.payload.data.list.length, 1);
    assert.equal(filtered.payload.data.list[0].employeeId, 'U001');
    const missingIn = await request('/admin/attendance?date=2026-10-27&status=missing_in', admin);
    assert.ok(missingIn.payload.data.list.length > 0);
    assert.ok(missingIn.payload.data.list.every((item: { status: string }) => item.status === 'missing_in'));
    assert.equal(missingIn.payload.data.summary.missingIn, missingIn.payload.data.list.length);
    assert.equal((await request('/admin/attendance?date=2026-02-30', admin)).status, 400);
    assert.equal((await request('/admin/attendance?date=2026-10-28', admin)).status, 400);
    assert.equal((await request('/attendance/punch', employee, 'POST', { type: 'out', ...position })).payload.data.ok, false);
    t.mock.timers.setTime(new Date('2026-10-28T08:30:00').getTime());
    const rest = await request('/attendance/today', employee);
    assert.equal(rest.payload.data.status, 'rest');
    assert.equal(rest.payload.data.nextType, 'wait');
    assert.equal((await request('/admin/attendance?month=2026-10&employeeId=U001', admin)).payload.data.list.find((item: { date: string }) => item.date === '2026-10-28').status, 'rest');
    assert.equal((await request('/attendance/punch', employee, 'POST', { type: 'in', ...position })).payload.data.ok, false);
    t.mock.timers.setTime(new Date('2026-10-29T08:30:00').getTime());
    assert.equal((await request('/attendance/today', employee)).payload.data.nextType, 'in');
    assert.equal((await request('/attendance/punch', employee, 'POST', { type: 'in', ...position })).payload.data.ok, true);
    const otherEmployee = issueTokens('U005').accessToken;
    const simultaneous = await Promise.all([
      request('/attendance/punch', otherEmployee, 'POST', { type: 'in', ...position }),
      request('/attendance/punch', otherEmployee, 'POST', { type: 'in', ...position }),
    ]);
    assert.equal(simultaneous.filter((result) => result.payload.data.ok).length, 1);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
