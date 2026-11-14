import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('加班打卡须经本人审批、从申请开始时间开放并独立于普通考勤，跨日计算实际时长', async (t) => {
  const database = `yunqi_overtime_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true; process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { issueTokens } = await import('../src/miniprogram/auth/authService'); const { config } = await import('../src/config');
    const adminRow = await pool.queryOne<{ id: number }>("SELECT id FROM admins WHERE role = 'super_admin' LIMIT 1"); assert.ok(adminRow);
    const admin = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String(adminRow.id) }); const employee = issueTokens('U001').accessToken; const other = issueTokens('U005').accessToken;
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any } }; };
    await conn.query(`INSERT INTO \`${database}\`.attendance_settings (id, start_time, in_end_time, end_time, out_end_time, rest_dates, latitude, longitude, radius) VALUES (1, '08:00', '10:00', '17:00', '18:00', ?, 23.1, 113.3, 100)`, [JSON.stringify(['2026-10-27'])]);
    const form = JSON.stringify([{ label: '加班日期', value: '2026-10-27' }, { label: '开始时间', value: '19:30' }, { label: '结束时间', value: '20:00' }, { label: '补偿方式', value: '加班费' }]);
    await conn.query(`INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES ('OT1','overtime','加班','加班','approved','U001','员工','','员工',?,NOW()), ('OT2','overtime','加班','加班','pending','U001','员工','','员工',?,NOW()), ('OT5','overtime','加班','加班','approved','U001','员工','','员工',?,NOW())`, [form, form, form]);
    const position = { latitude: 23.10012, longitude: 113.3, accuracy: 10 };
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-27T19:29:00') });
    const before = (await call('/attendance/overtime', employee)).body.data;
    assert.equal(before.length, 2); assert.ok(before.every((item: any) => !item.canPunch));
    assert.notEqual((await call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT1', type: 'in', ...position })).body.data?.ok, true);
    t.mock.timers.setTime(new Date('2026-10-27T19:30:00').getTime());
    assert.notEqual((await call('/attendance/overtime/punch', other, 'POST', { approvalId: 'OT1', type: 'in', ...position })).body.data?.ok, true);
    assert.notEqual((await call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT2', type: 'in', ...position })).body.data?.ok, true);
    assert.notEqual((await call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT1', type: 'in' })).body.data?.ok, true);
    const simultaneous = await Promise.all([call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT1', type: 'in', ...position }), call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT1', type: 'in', ...position })]);
    assert.equal(simultaneous.filter(r => r.body.data?.ok).length, 1);
    const inProgress = (await call('/attendance/overtime', employee)).body.data;
    assert.equal(inProgress.find((item: any) => item.approvalId === 'OT1').nextType, 'out');
    assert.equal(inProgress.find((item: any) => item.approvalId === 'OT5').canPunch, false);
    assert.notEqual((await call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT5', type: 'in', ...position })).body.data?.ok, true);
    const batch = await call('/admin/hr/payroll-batches', admin, 'POST', { month: '2026-10' }); const batchId = batch.body.data.id;
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batch_items (batch_id,employee_id,gross,deductions,net,note) VALUES (?, 'U001',1000,0,1000,'')`, [batchId]);
    t.mock.timers.setTime(new Date('2026-10-28T02:00:00').getTime());
    assert.equal((await call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT1', type: 'out', ...position })).body.data?.ok, true);
    assert.notEqual((await call('/attendance/overtime/punch', employee, 'POST', { approvalId: 'OT1', type: 'out', ...position })).body.data?.ok, true);
    const attendance = await call('/admin/attendance?date=2026-10-27&employeeId=U001&status=overtime', admin);
    assert.equal(attendance.status, 200); assert.equal(attendance.body.data.list[0].status, 'rest'); assert.equal(attendance.body.data.list[0].overtimeMinutes, 390);
    const restForm = form.replace('加班费', '调休');
    await conn.query(`INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES ('OT3','overtime','加班','加班','approved','U001','员工','','员工',?,NOW()), ('OT4','overtime','加班','加班','approved','U001','员工','','员工',?,NOW())`, [restForm, form]);
    await conn.query(`INSERT INTO \`${database}\`.attendance_overtime_punches (approval_id,employee_id,check_in,check_out) VALUES ('OT3','U001','2026-10-26 19:00:00','2026-10-26 21:00:00')`);
    assert.equal((await call('/admin/hr/overtime-payroll-rule-config', admin, 'PUT', { calculation: 'range', rules: [{ minHours: 0, maxHours: null, hourlyRate: 20 }] })).status, 200);
    let item = (await call(`/admin/hr/payroll-batches/${batchId}/items`, admin)).body.data[0];
    assert.equal(item.overtimeSeconds, 0); assert.equal(item.overtimePay, 0); assert.equal(item.gross, 1000);
    await conn.query(`INSERT INTO \`${database}\`.attendance_overtime_punches (approval_id,employee_id,check_in,check_out) VALUES ('OT4','U001','2026-10-28 00:00:00','2026-10-28 00:30:00')`);
    assert.equal((await call('/admin/hr/overtime-payroll-rule-config', admin, 'PUT', { calculation: 'range', rules: [{ minHours: 0, maxHours: null, hourlyRate: 30 }] })).status, 200);
    item = (await call(`/admin/hr/payroll-batches/${batchId}/items`, admin)).body.data[0]; assert.equal(item.overtimePay, 0); assert.equal(item.gross, 1000);
    assert.equal((await call(`/admin/hr/payroll-batches/${batchId}/review`, admin, 'POST', {})).status, 200);

  } finally {
    if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end();
  }
});
