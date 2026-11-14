import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('四种出勤规则模式可保存并读取旧数据', async () => {
  const database = `yunqi_rules_modes_${randomBytes(8).toString('hex')}`;
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
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any; message?: string } };
    };
    await conn.query(`INSERT INTO \`${database}\`.admins (username,password_hash,name,role,status,created_at) VALUES ('hr-test','unused','测试','hr_admin',1,NOW())`);
    const [hrRows] = await conn.query(`SELECT id FROM \`${database}\`.admins WHERE username='hr-test'`);
    const hr = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String((hrRows as any[])[0].id) });
    const deniedV2 = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr/attendance-payroll-rule-config-v2`, { headers: { Authorization: `Bearer ${hr}` } });
    assert.equal(deniedV2.status, 403);
    const old = [{ minRate: 100, maxRate: 100, adjustment: 200 }, { minRate: 0, maxRate: 100, adjustment: 0 }];
    await conn.query(`INSERT INTO \`${database}\`.hr_settings (setting_key,value_json,updated_at) VALUES ('payroll_attendance_rules',?,NOW())`, [JSON.stringify(old)]);
    assert.deepEqual((await call('/attendance-payroll-rule-config-v2')).body.data, { mode: 'rate_attendance', rules: old });
    for (const mode of ['rate_absence', 'days_attendance', 'days_absence']) {
      const rules = [{ minRate: 0, maxRate: mode === 'rate_absence' ? 100 : null, adjustment: -10 }];
      const saved = await call('/attendance-payroll-rule-config-v2', 'PUT', { mode, rules });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.deepEqual((await call('/attendance-payroll-rule-config-v2')).body.data, { mode, rules });
    }
    const invalid = await call('/attendance-payroll-rule-config-v2', 'PUT', { mode: 'days_absence', rules: [{ minRate: 0, maxRate: 5, adjustment: 0 }] });
    assert.equal(invalid.status, 400);
    assert.equal((await call('/attendance-payroll-rule-config-v2')).body.data.mode, 'days_absence');
    for (const mode of ['rate_attendance', 'rate_absence', 'days_attendance', 'days_absence']) {
      const savedConfig = { mode, calculation: 'unit', unitAdjustment: -10.25 };
      const saved = await call('/attendance-payroll-rule-config-v2', 'PUT', savedConfig);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.deepEqual((await call('/attendance-payroll-rule-config-v2')).body.data, savedConfig);
    }
    const invalidUnit = await call('/attendance-payroll-rule-config-v2', 'PUT', { mode: 'rate_absence', calculation: 'unit', unitAdjustment: 0.001 });
    assert.equal(invalidUnit.status, 400);
    assert.equal((await call('/attendance-payroll-rule-config-v2')).body.data.calculation, 'unit');
    assert.equal((await call('/attendance-payroll-rule-config')).status, 404);
    assert.deepEqual((await call('/attendance-payroll-rule-config-v2', 'PUT', { mode: 'rate_attendance', calculation: 'range', rules: old })).body.data, { mode: 'rate_attendance', calculation: 'range', rules: old });
    assert.deepEqual((await call('/attendance-payroll-rule-config-v2')).body.data, { mode: 'rate_attendance', calculation: 'range', rules: old });
    assert.equal((await call('/attendance-payroll-rules')).status, 404);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
