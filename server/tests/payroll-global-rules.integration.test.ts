import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('全员出勤规则迁移、校验及草稿批次删除', async () => {
  const database = `yunqi_global_payroll_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any; message?: string } }; };

    const rules = [{ minRate: 0, maxRate: 90, adjustment: -200 }, { minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 100, maxRate: 100, adjustment: 200 }];
    assert.equal((await call('/admin/hr/employees/U001/salary', admin, 'PUT', { performance: 1000, attendanceRules: rules })).status, 200);
    const migrated = await call('/admin/hr/attendance-payroll-rule-config-v2', admin); assert.equal(migrated.status, 200); assert.deepEqual(migrated.body.data, { mode: 'rate_attendance', rules });
    const invalid = await call('/admin/hr/attendance-payroll-rule-config-v2', admin, 'PUT', { mode: 'rate_attendance', rules: [{ minRate: 0, maxRate: 90, adjustment: 1 }, { minRate: 89, maxRate: 100, adjustment: 0 }] }); assert.equal(invalid.status, 400);
    for (const incomplete of [
      [],
      [{ minRate: 100, maxRate: 100, adjustment: 0 }],
      [{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 90, maxRate: 100, adjustment: 0 }],
      [{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 90, adjustment: 0 }],
      [{ minRate: 0, maxRate: 100, adjustment: 0 }, { minRate: 100, maxRate: 100, adjustment: 0 }],
    ]) assert.equal((await call('/admin/hr/attendance-payroll-rule-config-v2', admin, 'PUT', { mode: 'rate_attendance', rules: incomplete })).status, 400, JSON.stringify(incomplete));
    const next = [{ minRate: 100, maxRate: 100, adjustment: 300 }, { minRate: 0, maxRate: 100, adjustment: 0 }]; assert.equal((await call('/admin/hr/attendance-payroll-rule-config-v2', admin, 'PUT', { mode: 'rate_attendance', rules: next })).status, 200); assert.deepEqual((await call('/admin/hr/attendance-payroll-rule-config-v2', admin)).body.data, { mode: 'rate_attendance', rules: next });
    assert.deepEqual((await call('/admin/hr/employees/U001/salary', admin)).body.data.attendanceRules, rules);
    const batch = await call('/admin/hr/payroll-batches', admin, 'POST', { month: '2026-08' }); assert.equal(batch.status, 200); const id = batch.body.data.id;
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batch_items (batch_id, employee_id, gross, deductions, net, note) VALUES (?, 'U001', 2000, 0, 2000, '')`, [id]);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}`, admin, 'DELETE')).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`, admin)).status, 404);
    const [remaining] = await conn.query(`SELECT id FROM \`${database}\`.hr_payroll_batch_items WHERE batch_id = ?`, [id]); assert.equal((remaining as any[]).length, 0);
    const replacement = await call('/admin/hr/payroll-batches', admin, 'POST', { month: '2026-08' }); assert.equal(replacement.status, 200); const id2 = replacement.body.data.id;
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batch_items (batch_id, employee_id, gross, deductions, net, note) VALUES (?, 'U001', 2000, 0, 2000, '')`, [id2]);
    assert.equal((await call(`/admin/hr/payroll-batches/${id2}/review`, admin, 'POST', {})).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id2}`, admin, 'DELETE')).status, 400);
    assert.equal((await call(`/admin/hr/payroll-batches/${id2}/items`, admin)).body.data.length, 1);
    const raceBatch = await call('/admin/hr/payroll-batches', admin, 'POST', { month: '2026-07' }); const raceId = raceBatch.body.data.id;
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batch_items (batch_id, employee_id, gross, deductions, net, note) VALUES (?, 'U001', 1000, 0, 1000, '')`, [raceId]);
    const race = await Promise.all([call(`/admin/hr/payroll-batches/${raceId}`, admin, 'DELETE'), call(`/admin/hr/payroll-batches/${raceId}/review`, admin, 'POST', {})]);
    assert.equal(race.filter(result => result.status === 200).length, 1); assert.ok(race.some(result => [400, 404].includes(result.status)));
    await conn.query(`DELETE FROM \`${database}\`.hr_settings WHERE setting_key IN ('payroll_attendance_rules', 'payroll_attendance_rule_config')`);
    assert.equal((await call('/admin/hr/employees/U005/salary', admin, 'PUT', { attendanceRules: next })).status, 200);
    const ambiguous = await call('/admin/hr/attendance-payroll-rule-config-v2', admin); assert.equal(ambiguous.status, 409);
    assert.equal((await call('/admin/hr/attendance-payroll-rule-config-v2', admin, 'PUT', { mode: 'rate_attendance', rules: next })).status, 200);
    assert.deepEqual((await call('/admin/hr/attendance-payroll-rule-config-v2', admin)).body.data, { mode: 'rate_attendance', rules: next });

  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
