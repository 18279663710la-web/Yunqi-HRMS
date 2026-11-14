import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test('申请中可撤销并恢复账号，已离职按复职日期恢复', async () => {
  const database = `yunqi_rehire_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool');
    closePool = pool.closePool;
    await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/employees/adminEmployeeService')).backfillEmployeeJobCategories();
    await (await import('../src/domains/employees/jobTitleService')).backfillJobTitles();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as { data?: any; message?: string } };
    };
    const password = 'secret1';
    assert.equal((await call('/admin/employees/U001/account/reset-password', 'POST', { password })).status, 200);
    const employee = (await call('/admin/employees/U001')).body.data;
    const form = new FormData();
    form.append('payload', JSON.stringify({ employeeId: 'U001', lastDate: localDate(), note: '' }));
    const departed = await fetch(`http://127.0.0.1:${addr.port}/api/admin/hr/departures`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form });
    const departedBody = await departed.json() as { data?: { id: number; status: string }; message?: string };
    assert.equal(departed.status, 200, departedBody.message);
    assert.equal(departedBody.data?.status, 'departed');

    const listed = await call('/admin/employees?accountStatus=all&page=1&pageSize=100');
    assert.equal(listed.body.data.list.some((row: { id: string }) => row.id === 'U001'), false);
    const options = await call('/admin/employees/options');
    assert.equal(options.body.data.some((row: { id: string }) => row.id === 'U001'), false);
    const blocked = await call('/admin/employees/U001', 'PUT', { ...employee, account: undefined, employmentStatus: undefined, deptName: undefined, leaderName: undefined });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.message || '', /离职/);
    const punch = await (await import('../src/domains/attendance/attendanceService')).punch('U001', 'in');
    assert.equal(punch.ok, false);
    assert.match(punch.message, /离职/);

    const scheduled = await call(`/admin/hr/departures/${departedBody.data?.id}/reinstate`, 'POST', { reinstatementDate: localDate(3) });
    assert.equal(scheduled.status, 200, scheduled.body.message);
    assert.equal(scheduled.body.data.status, 'pending_reinstatement');
    const waiting = await call('/admin/hr/departures');
    const pending = waiting.body.data.find((row: { id: number }) => row.id === departedBody.data?.id);
    assert.equal(pending.status, 'pending_reinstatement');
    assert.equal(pending.reinstatementDate, localDate(3));
    assert.equal((await call('/admin/employees?accountStatus=all&page=1&pageSize=100')).body.data.list.some((row: { id: string }) => row.id === 'U001'), false);
    assert.notEqual((await call('/auth/password-login', 'POST', { loginName: employee.account.loginName, password })).status, 200);
    assert.equal((await call(`/admin/hr/departures/${departedBody.data?.id}/cancel`, 'POST', {})).status, 400);

    await pool.execute('UPDATE hr_employee_departures SET reinstatement_date = CURDATE() WHERE id = ?', [departedBody.data?.id]);
    const restored = await call('/admin/employees?accountStatus=all&page=1&pageSize=100');
    assert.equal(restored.body.data.list.some((row: { id: string }) => row.id === 'U001'), true);
    const login = await call('/auth/password-login', 'POST', { loginName: employee.account.loginName, password });
    assert.equal(login.status, 200, login.body.message);

    const otherId = restored.body.data.list.find((row: { id: string }) => row.id !== 'U001').id as string;
    assert.equal((await call(`/admin/employees/${otherId}/account/reset-password`, 'POST', { password })).status, 200);
    const other = (await call(`/admin/employees/${otherId}`)).body.data;
    const futureForm = new FormData();
    futureForm.append('payload', JSON.stringify({ employeeId: otherId, lastDate: localDate(3), note: '' }));
    const applied = await fetch(`http://127.0.0.1:${addr.port}/api/admin/hr/departures`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: futureForm });
    const appliedBody = await applied.json() as { data?: { id: number }; message?: string };
    assert.equal(applied.status, 200, appliedBody.message);
    assert.equal((await call(`/admin/hr/departures/${appliedBody.data?.id}/cancel`, 'POST', {})).status, 200);
    assert.equal((await call('/admin/employees?accountStatus=all&page=1&pageSize=100')).body.data.list.some((row: { id: string }) => row.id === otherId), true);
    const cancelledLogin = await call('/auth/password-login', 'POST', { loginName: other.account.loginName, password });
    assert.equal(cancelledLogin.status, 200, cancelledLogin.body.message);

    const again = new FormData();
    again.append('payload', JSON.stringify({ employeeId: otherId, lastDate: localDate(), note: '' }));
    const departedAgain = await fetch(`http://127.0.0.1:${addr.port}/api/admin/hr/departures`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: again });
    const departedAgainBody = await departedAgain.json() as { data?: { id: number }; message?: string };
    assert.equal(departedAgain.status, 200, departedAgainBody.message);
    const immediate = await call(`/admin/hr/departures/${departedAgainBody.data?.id}/reinstate`, 'POST', { reinstatementDate: localDate() });
    assert.equal(immediate.status, 200, immediate.body.message);
    assert.equal(immediate.body.data.status, 'reinstated');
    assert.equal((await call('/admin/employees?accountStatus=all&page=1&pageSize=100')).body.data.list.some((row: { id: string }) => row.id === otherId), true);
    assert.equal((await call('/auth/password-login', 'POST', { loginName: other.account.loginName, password })).status, 200);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
