import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('已复核工资批次按明细原子登记发放，重复和草稿均被拒绝', async () => {
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
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batches (id, payroll_month, status, created_at) VALUES (1, '2026-01', 'draft', NOW()), (2, '2026-02', 'reviewed', NOW()), (3, '2026-03', 'reviewed', NOW())`);
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batch_items (batch_id, employee_id, gross, deductions, net, note) VALUES (1, 'U001', 100, 0, 100, ''), (2, 'U001', 100.25, 0, 100.25, ''), (2, 'U005', 200.50, 0, 200.50, ''), (3, 'U001', 400, 0, 400, ''), (3, 'U005', 500, 0, 500, '')`);
    assert.equal((await call('/payroll/batch', 'POST', { batchId: 1 })).status, 400);
    assert.equal((await call('/payroll/batch', 'POST', { batchId: 999 })).status, 404);
    assert.equal((await call('/payroll/batch', 'POST', { batchId: 2, note: '已发放', month: '1999-01', amount: 1 })).status, 200);
    const records = (await call('/payroll')).body.data;
    assert.deepEqual(records.map((r: any) => [r.employeeId, r.month, Number(r.amount), r.batchId]).sort(), [['U001', '2026-02', 100.25, 2], ['U005', '2026-02', 200.5, 2]]);
    assert.equal((await call('/payroll/batch', 'POST', { batchId: 2 })).status, 409);
    assert.equal((await call('/payroll', 'POST', { employeeId: 'U005', month: '2026-03', amount: 1, note: '' })).status, 200);
    assert.equal((await call('/payroll/batch', 'POST', { batchId: 3 })).status, 409);
    assert.equal((await call('/payroll')).body.data.filter((r: any) => r.month === '2026-03').length, 1);
    const attempts = await Promise.all([call('/payroll/batch', 'POST', { batchId: 2 }), call('/payroll/batch', 'POST', { batchId: 2 })]);
    assert.deepEqual(attempts.map(x => x.status), [409, 409]);
  } finally {
    if (closeServer) await closeServer(); if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end();
  }
});
