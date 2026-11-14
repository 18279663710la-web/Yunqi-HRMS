import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('加班绩效模式兼容旧规则、隔离权限且不重算工资', async () => {
  const database = `yunqi_overtime_config_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true; process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const admin = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: '1' });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = async (path: string, method = 'GET', body?: unknown, token = admin) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any; message?: string } };
    };
    await conn.query(`INSERT INTO \`${database}\`.admins (username,password_hash,name,role,status,created_at) VALUES ('hr-test','unused','测试','hr_admin',1,NOW())`);
    const [hrRows] = await conn.query(`SELECT id FROM \`${database}\`.admins WHERE username='hr-test'`);
    const hr = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String((hrRows as any[])[0].id) });
    assert.equal((await call('/overtime-payroll-rule-config', 'GET', undefined, hr)).status, 403);
    assert.equal((await call('/overtime-payroll-rule-config', 'PUT', { calculation: 'unit', hourlyRate: 20 }, hr)).status, 403);

    const defaultRange = [{ minHours: 0, maxHours: null, hourlyRate: 0 }];
    assert.deepEqual((await call('/overtime-payroll-rule-config')).body.data, { calculation: 'range', rules: defaultRange });
    const oldRules = [{ minHours: 0, maxHours: 10, hourlyRate: 12.5 }, { minHours: 10, maxHours: null, hourlyRate: 20 }];
    await conn.query(`INSERT INTO \`${database}\`.hr_settings (setting_key,value_json,updated_at) VALUES ('payroll_overtime_rules',?,NOW())`, [JSON.stringify(oldRules)]);
    assert.deepEqual((await call('/overtime-payroll-rule-config')).body.data, { calculation: 'range', rules: oldRules });
    const { calculateEmployeeOvertime } = await import('../src/domains/payroll/overtimePayrollService');
    const legacyResult = await pool.transaction(conn => calculateEmployeeOvertime(conn, 'U001', '2020-02'));
    assert.deepEqual(legacyResult.rules, oldRules);
    const newRules = [{ minHours: 0, maxHours: 8, hourlyRate: 18 }, { minHours: 8, maxHours: null, hourlyRate: 22 }];
    assert.deepEqual((await call('/overtime-payroll-rule-config', 'PUT', { calculation: 'range', rules: newRules })).body.data, { calculation: 'range', rules: newRules });
    const rangeResult = await pool.transaction(conn => calculateEmployeeOvertime(conn, 'U001', '2020-02'));
    assert.deepEqual(rangeResult.rules, newRules);
    const batch = await call('/payroll-batches', 'POST', { month: '2020-02' }); const batchId = batch.body.data.id;
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batch_items (batch_id,employee_id,gross,deductions,net,note) VALUES (?, 'U001',1000,0,1000,'')`, [batchId]);
    const reviewed = await call('/payroll-batches', 'POST', { month: '2020-03' }); const reviewedId = reviewed.body.data.id;
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batch_items (batch_id,employee_id,gross,deductions,net,note) VALUES (?, 'U001',900,0,900,'')`, [reviewedId]);
    assert.equal((await call(`/payroll-batches/${reviewedId}/review`, 'POST', {})).status, 200);
    const unit = { calculation: 'unit', hourlyRate: 25.75 };
    assert.deepEqual((await call('/overtime-payroll-rule-config', 'PUT', unit)).body.data, unit);
    assert.deepEqual((await call('/overtime-payroll-rule-config')).body.data, unit);
    await assert.rejects(pool.transaction(conn => calculateEmployeeOvertime(conn, 'U001', '2020-02')), (error: any) => error.status === 409 && /按单位/.test(error.message));
    const explicitResult = await pool.transaction(conn => calculateEmployeeOvertime(conn, 'U001', '2020-02', oldRules));
    assert.deepEqual(explicitResult.rules, oldRules);
    assert.equal((await call('/overtime-payroll-rules')).status, 404);
    assert.equal((await call('/overtime-payroll-rule-config', 'PUT', { calculation: 'unit', hourlyRate: 0.001 })).status, 400);
    assert.deepEqual((await call('/overtime-payroll-rule-config')).body.data, unit);
    assert.equal((await call(`/payroll-batches/${batchId}/items`)).body.data[0].net, 1000);
    assert.equal((await call(`/payroll-batches/${reviewedId}/items`)).body.data[0].net, 900);
    assert.equal((await call('/overtime-payroll-rule-config', 'PUT', { calculation: 'range', rules: oldRules })).status, 200);
    assert.deepEqual((await call('/overtime-payroll-rule-config')).body.data, { calculation: 'range', rules: oldRules });
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
