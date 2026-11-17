import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('员工出勤率规则校验、隔离和历史', async () => {
  const database = `yunqi_attendance_rule_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any; message?: string } }; };

    const rules = [{ minRate: 0, maxRate: 90, adjustment: -200 }, { minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 100, maxRate: 100, adjustment: 150 }];
    const saved = await call('/admin/hr/employees/U001/salary', admin, 'PUT', { performance: 1000, attendanceRules: rules }); assert.equal(saved.status, 200); assert.deepEqual(saved.body.data.attendanceRules, rules);
    const read = await call('/admin/hr/employees/U001/salary', admin); assert.deepEqual(read.body.data.attendanceRules, rules);
    const other = await call('/admin/hr/employees/U005/salary', admin); assert.equal(other.body.data.attendanceRules, undefined);
    const bad = [
      [{ minRate: 0, maxRate: 90, adjustment: 0 }, { minRate: 89, maxRate: 100, adjustment: 1 }],
      [{ minRate: 100, maxRate: 100, adjustment: 1 }, { minRate: 100, maxRate: 100, adjustment: 2 }],
      [{ minRate: -1, maxRate: 20, adjustment: 0 }], [{ minRate: 20, maxRate: 101, adjustment: 0 }],
      [{ minRate: 20, maxRate: 20, adjustment: 0 }], [{ minRate: 0, maxRate: 90, adjustment: 0.001 }],
    ];
    for (const attendanceRules of bad) { const r = await call('/admin/hr/employees/U001/salary', admin, 'PUT', { performance: 1000, attendanceRules }); assert.equal(r.status, 400); }
    const legacyClient = await call('/admin/hr/employees/U001/salary', admin, 'PUT', { performance: 1100 }); assert.equal(legacyClient.status, 200); assert.deepEqual(legacyClient.body.data.attendanceRules, rules);
    const history = (await call('/admin/hr/employees/U001/salary/history', admin)).body.data; assert.equal(history.length, 2); assert.deepEqual(history[0].data.attendanceRules, rules); assert.deepEqual(history[1].data.attendanceRules, rules);
    const cleared = await call('/admin/hr/employees/U001/salary', admin, 'PUT', { attendanceRules: [] }); assert.equal(cleared.status, 200); assert.deepEqual(cleared.body.data.attendanceRules, []);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
