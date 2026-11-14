import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('人事事件、合同历史与工资复核', async () => {
  const database = `yunqi_hr_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool;
    await pool.ensureSchema(); await (await import('../src/shared/db/seed')).seedDatabase();
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
    const forbidden = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr/payroll-batches`, { headers: { Authorization: `Bearer ${hrToken}` } });
    assert.equal(forbidden.status, 403);
    assert.equal((await request('/onboarding/task-template', 'PUT', [{ title: '签署合同', required: true }])).status, 404);
    assert.equal((await request('/events', 'POST', { employeeId: 'U001', type: '转正', effectiveDate: '2026-10-31', note: '记录' })).status, 200);
    assert.equal((await request('/events?employeeId=U001')).body.data.length, 1);
    assert.equal((await request('/employees/U001/contract', 'PUT', { number: 'A1', startDate: '2026-01-01', endDate: '2026-12-31' })).status, 200);
    assert.equal((await request('/employees/U001/contract', 'PUT', { number: 'A2', startDate: '2026-01-01', endDate: '2026-12-31' })).status, 200);
    const history = await request('/employees/U001/contract/history');
    assert.equal(history.body.data.length, 2);
    assert.equal(history.body.data[0].data.number, 'A2');
    await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES ('U001', 'salary', ?, NOW())`, [JSON.stringify({ base: 3000 })]);
    assert.equal((await request('/employees/U001/salary', 'PUT', { base: 4000 })).status, 200);
    const salaryHistory = await request('/employees/U001/salary/history');
    assert.deepEqual(salaryHistory.body.data.map((entry: { data: { base: number } }) => entry.data.base), [4000, 3000]);
    const model = (await request('/salary-model')).body.data;
    assert.equal((await request('/salary-model', 'PUT', { version: model.version, fixedFields: ['基本工资'], extendedFields: [] })).status, 200);
    for (const employeeId of ['U001', 'U005']) {
      await conn.query(`INSERT INTO \`${database}\`.hr_self_onboarding (employee_id, expected_date, template_json, answers_json, created_at, submitted_at, archived_at, archived_by) VALUES (?, '2026-01-01', '[]', '{}', NOW(), NOW(), NOW(), 1)`, [employeeId]);
      await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES (?, 'contract', ?, NOW()) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)`, [employeeId, JSON.stringify({ number: 'C', startDate: '2026-01-01', endDate: '2026-12-31' })]);
      await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES (?, 'salary', ?, NOW()) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)`, [employeeId, JSON.stringify({ effectiveDate: '2026-01-01', values: { 基本工资: 4000 } })]);
    }
    const batch = await request('/payroll-batches', 'POST', { month: '2026-10' });
    assert.equal(batch.status, 200);
    const batchId = batch.body.data.id;
    assert.equal((await request(`/payroll-batches/${batchId}/review`, 'POST', {})).status, 400);
    assert.equal((await request(`/payroll-batches/${batchId}/items`, 'POST', { employeeId: 'U001' })).status, 200);
    assert.equal((await request(`/payroll-batches/${batchId}/items`, 'POST', { employeeId: 'U001' })).status, 409);
    const draftItem = await request(`/payroll-batches/${batchId}/items`, 'POST', { employeeId: 'U005' });
    assert.equal(draftItem.status, 200);
    const draftRows = (await request(`/payroll-batches/${batchId}/items`)).body.data;
    assert.equal((await request(`/payroll-batches/${batchId}/items/${draftRows.find((row: { employeeId: string }) => row.employeeId === 'U005').id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/payroll-batches/${batchId}/review`, 'POST', {})).status, 200);
    assert.equal((await request(`/payroll-batches/${batchId}/items`, 'POST', { employeeId: 'U002' })).status, 400);
    const items = await request(`/payroll-batches/${batchId}/items`);
    assert.equal((await request(`/payroll-batches/${batchId}/items/${items.body.data[0].id}`, 'DELETE')).status, 400);
    assert.equal((await request(`/payroll-batches/${batchId}/items`)).body.data[0].net, 4000);
    assert.equal((await request('/offboarding', 'POST', { employeeId: 'U001', lastDate: '2026-11-30', note: '' })).status, 404);
  } finally {
    if (closeServer) await closeServer(); if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end();
  }
});
