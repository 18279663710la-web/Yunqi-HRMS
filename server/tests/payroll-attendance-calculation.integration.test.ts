import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('出勤规则修改不改变历史草稿及已复核批次金额', async () => {
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

    const month = '2020-02';
    const rest = Array.from({ length: 25 }, (_, i) => `2020-02-${String(i + 5).padStart(2, '0')}`);
    await conn.query(`INSERT INTO ${database}.attendance_settings (id,start_time,end_time,rest_dates,address,floor,latitude,longitude,radius) VALUES (1,'09:00','18:00',?,'','',0,0,100) ON DUPLICATE KEY UPDATE rest_dates=VALUES(rest_dates)`, [JSON.stringify(rest)]);
    await conn.query(`DELETE FROM ${database}.attendance_punches WHERE punch_date BETWEEN '2020-02-01' AND '2020-02-29'`);
    for (const employee of ['U001', 'U005']) {
      const days = employee === 'U001' ? [1, 2] : [1, 2, 3, 4];
      for (const day of days) await conn.query(`INSERT INTO ${database}.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES (?, ?, '09:00', '18:00', 'admin', NOW(), NOW())`, [employee, `2020-02-0${day}`]);
    }
    const batch = await call('/admin/hr/payroll-batches', admin, 'POST', { month }); const id = batch.body.data.id;
    for (const employeeId of ['U001', 'U005']) await conn.query(`INSERT INTO ${database}.hr_payroll_batch_items (batch_id, employee_id, base_gross, gross, deductions, net, note) VALUES (?, ?, 1000, 1000, 100, 900, '')`, [id, employeeId]);
    const rules = [{ minRate: 100, maxRate: 100, adjustment: 200 }, { minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 90, adjustment: -200 }];
    assert.equal((await call('/admin/hr/attendance-payroll-rules', admin, 'PUT', rules)).status, 200);
    let rows = (await call(`/admin/hr/payroll-batches/${id}/items`, admin)).body.data;
    assert.deepEqual(rows.map((r: any) => [r.employeeId, r.gross, r.net]), [['U001',1000,900],['U005',1000,900]]);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/review`, admin, 'POST', {})).status, 200);
    assert.equal((await call('/admin/hr/attendance-payroll-rules', admin, 'PUT', [{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 100, adjustment: 0 }])).status, 200);
    rows = (await call(`/admin/hr/payroll-batches/${id}/items`, admin)).body.data;
    assert.equal(rows[0].gross, 1000); assert.equal(rows[0].net, 900);

  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});



