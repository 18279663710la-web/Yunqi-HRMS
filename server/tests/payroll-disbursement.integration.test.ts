import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('工资批次按月份查询，历史发放记录保持只读', async () => {
  const database = `yunqi_disbursement_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const admin = await pool.queryOne<{ id: number }>("SELECT id FROM admins WHERE role = 'super_admin' LIMIT 1"); assert.ok(admin);
    const token = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: String(admin.id) });
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_records (employee_id, payroll_month, amount, note, created_at) VALUES ('U001', '2026-02', 100.25, '历史记录', NOW())`);
    assert.ok([401, 404].includes((await call('/payroll', 'POST', { employeeId: 'U005', month: '2026-03', amount: 1, note: '' })).status));
    assert.ok([401, 404].includes((await call('/payroll/batch', 'POST', { batchId: 1 })).status));
    const records = (await call('/payroll')).body.data;
    assert.deepEqual(records.map((r: any) => [r.employeeId, r.month, Number(r.amount), r.note]), [['U001', '2026-02', 100.25, '历史记录']]);
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batches (payroll_month, status, created_at) VALUES ('2026-01', 'draft', NOW()), ('2026-02', 'reviewed', NOW())`);
    const batches = await call('/payroll-batches?month=2026-02');
    assert.equal(batches.status, 200);
    assert.deepEqual(batches.body.data.map((batch: any) => [batch.month, batch.status]), [['2026-02', 'reviewed']]);
    assert.equal((await call('/payroll-batches?month=2026-13')).status, 400);
    assert.equal((await call('/payroll-batches')).body.data.length, 2);
  } finally {
    if (closeServer) await closeServer(); if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end();
  }
});
