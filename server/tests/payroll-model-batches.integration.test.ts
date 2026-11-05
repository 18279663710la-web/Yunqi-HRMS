import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('工资批次按固定模型算薪，扩展字段手工填写并锁定快照', async () => {
  const database = `yunqi_payroll_model_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true; process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const adminRow = await pool.queryOne<{ id: number }>("SELECT id FROM admins WHERE role = 'super_admin' LIMIT 1"); assert.ok(adminRow);
    const admin = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String(adminRow.id) });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = async (path: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, body: data }; };
    const model = (await call('/admin/hr/salary-model')).body.data;
    const field = (name: string, category?: string) => ({ name, type: 'number', required: true, ...(category ? { category } : {}) });
    const saved = await call('/admin/hr/salary-model', 'PUT', { version: model.version, fixedFields: [field('基本工资'), field('职务津贴'), field('工龄奖')], extendedFields: [field('出勤天', 'info'), field('加班费', 'income'), field('扣社保', 'deduction')] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    for (const employeeId of ['U001', 'U013']) {
      await conn.query(`INSERT INTO \`${database}\`.hr_self_onboarding (employee_id, expected_date, template_json, answers_json, created_at, submitted_at, archived_at, archived_by) VALUES (?, '2026-01-01', '[]', '{}', NOW(), NOW(), NOW(), 1)`, [employeeId]);
      await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES (?, 'contract', ?, NOW()), (?, 'salary', ?, NOW())`, [employeeId, JSON.stringify({ number: 'C', startDate: '2026-01-01', endDate: '2027-01-01' }), employeeId, JSON.stringify({ effectiveDate: '2026-01-01', values: { 基本工资: 1000, 职务津贴: 200, 工龄奖: 30 }, base: 1000, allowance: null, performance: null })]);
    }
    assert.equal((await call('/admin/hr/overtime-payroll-rules', 'PUT', [{ minHours: 0, maxHours: null, hourlyRate: 20 }])).status, 200);
    assert.equal((await call('/admin/hr/attendance-payroll-rules', 'PUT', [{ minRate: 100, maxRate: 100, adjustment: 300 }, { minRate: 0, maxRate: 100, adjustment: 0 }])).status, 200);
    const batch = await call('/admin/hr/payroll-batches', 'POST', { month: '2026-09' }); const id = batch.body.data.id;
    const preview = await call(`/admin/hr/payroll-batches/${id}/auto-preview`);
    assert.equal(preview.status, 200); assert.equal(preview.body.data.candidates.length, 2); assert.equal(preview.body.data.candidates[0].baseGross, 1230);
    assert.deepEqual(preview.body.data.candidates[0].modelSnapshot.extended.map((field: any) => field.value), [0, 0, 0]);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`, 'POST', { employeeId: 'U001', gross: 1, deductions: 0 })).status, 400);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`, 'POST', { employeeId: 'U001' })).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/auto-items`, 'POST', {})).body.data.addedCount, 1);
    let items = (await call(`/admin/hr/payroll-batches/${id}/items`)).body.data; const item = items.find((row: any) => row.employeeId === 'U001');
    assert.equal(item.gross, 1230); assert.equal(item.net, 1230); assert.equal(item.attendanceAdjustment, 0); assert.equal(item.overtimePay, 0);
    const values = [{ name: '出勤天', value: 22 }, { name: '加班费', value: 100.5 }, { name: '扣社保', value: 50.25 }];
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items/${item.id}/extended`, 'PUT', { revision: 0, values })).status, 200);
    items = (await call(`/admin/hr/payroll-batches/${id}/items`)).body.data; const edited = items.find((row: any) => row.id === item.id);
    assert.equal(edited.gross, 1330.5); assert.equal(edited.deductions, 50.25); assert.equal(edited.net, 1280.25);
    assert.deepEqual(edited.modelSnapshot.extended.map((field: any) => field.value), [22, 100.5, 50.25]);
    const changedModel = await call('/admin/hr/salary-model', 'PUT', { version: saved.body.data.version, fixedFields: [field('基本工资'), field('职务津贴'), field('工龄奖')], extendedFields: [field('出勤天', 'info'), field('加班费', 'info'), field('扣社保', 'deduction')] });
    assert.equal(changedModel.status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`)).body.data.find((row: any) => row.id === item.id).modelSnapshot.extended[1].category, 'income');
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items/${item.id}/extended`, 'PUT', { revision: 0, values })).status, 409);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items/${item.id}/extended`, 'PUT', { revision: 1, values: values.slice(1) })).status, 400);
    assert.notEqual((await call(`/admin/hr/payroll-batches/${id}/recalculate-overtime`, 'POST', {})).status, 200);
    assert.equal((await call('/admin/hr/overtime-payroll-rules', 'PUT', [{ minHours: 0, maxHours: null, hourlyRate: 30 }])).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`)).body.data.find((row: any) => row.id === item.id).net, 1280.25);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/review`, 'POST', {})).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items/${item.id}/extended`, 'PUT', { revision: 1, values })).status, 400);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});


