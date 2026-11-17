import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('登记离职：未来日期为已申请，到期后锁定为已离职', async () => {
  const database = `yunqi_departure_reg_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, init?: RequestInit) => {
      const response = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${admin}`, ...(init?.headers || {}) },
      });
      return { status: response.status, body: await response.json() as { data?: any; message?: string } };
    };

    const future = new Date(); future.setUTCDate(future.getUTCDate() + 3);
    const futureDate = future.toISOString().slice(0, 10);
    const form = new FormData();
    form.append('payload', JSON.stringify({ employeeId: 'U001', lastDate: futureDate, note: '测试申请' }));
    const createdFuture = await call('/admin/hr/departures', { method: 'POST', body: form });
    assert.equal(createdFuture.status, 200);
    assert.equal(createdFuture.body.data.status, 'applied');

    const list = await call('/admin/hr/departures');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((row: any) => row.employeeId === 'U001' && row.status === 'applied'));

    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const { getEmployeeSessionVersion } = await import('../src/domains/accounts/employeeSessionService');
    const stillOk = await call('/me', { headers: { Authorization: `Bearer ${issueTokens('U001', await getEmployeeSessionVersion('U001')).accessToken}` } });
    assert.equal(stillOk.status, 200);

    await pool.execute("UPDATE approvals SET status = 'approved' WHERE id = 'FA20261015001'");
    const disabled = await call('/admin/employees/U005/account/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'disabled' }) });
    assert.equal(disabled.status, 200, disabled.body.message);
    const appliedForm = new FormData();
    appliedForm.append('payload', JSON.stringify({ employeeId: 'U005', lastDate: futureDate, note: '' }));
    const applied = await call('/admin/hr/departures', { method: 'POST', body: appliedForm });
    assert.equal(applied.status, 200, applied.body.message);
    assert.equal(applied.body.data.status, 'applied');
    const cancelled = await call(`/admin/hr/departures/${applied.body.data.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.status, 200, cancelled.body.message);
    const stillDisabled = await call('/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'zhoumingyuan', password: config.demoEmployeePassword }) });
    assert.equal(stillDisabled.status, 403, stillDisabled.body.message);
    assert.match(stillDisabled.body.message || '', /停用/);

    await pool.execute("UPDATE hr_employee_departures SET last_date = CURDATE() WHERE employee_id = 'U001' AND status = 'applied'");
    const locked = await call('/me', { headers: { Authorization: `Bearer ${issueTokens('U001', await getEmployeeSessionVersion('U001')).accessToken}` } });
    assert.equal(locked.status, 401);

    const after = await call('/admin/hr/departures');
    assert.ok(after.body.data.some((row: any) => row.employeeId === 'U001' && row.status === 'departed'));

    const otherId = (await pool.queryRows<{ id: string }>("SELECT id FROM employees WHERE id <> 'U001' ORDER BY id LIMIT 1"))[0]?.id;
    assert.ok(otherId);
    const todayForm = new FormData();
    todayForm.append('payload', JSON.stringify({ employeeId: otherId, lastDate: new Date().toISOString().slice(0, 10), note: '' }));
    const createdToday = await call('/admin/hr/departures', { method: 'POST', body: todayForm });
    assert.equal(createdToday.status, 200, createdToday.body.message);
    assert.equal(createdToday.body.data.status, 'departed');
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
