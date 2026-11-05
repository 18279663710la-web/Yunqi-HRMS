import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('人事资料仅超级管理员可管理，入职申请与工资登记可以重新读取', async () => {
  const database = `yunqi_hr_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool;
    await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'x', 'HR', 'hr_admin', 1, NOW())`);
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hr = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const request = async (path: string, token: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    assert.equal((await request('/employees', hr)).status, 403);
    assert.equal((await request('/employees/U001/salary', hr, 'PUT', { base: 100 })).status, 403);
    assert.equal((await request('/onboarding/fields', admin, 'PUT', ['姓名', '电话'])).status, 200);
    assert.equal((await request('/onboarding', admin, 'POST', { 姓名: '申请人' })).status, 400);
    assert.equal((await request('/onboarding', admin, 'POST', { 姓名: '申请人', 电话: '123' })).status, 200);
    assert.equal((await request('/onboarding', admin)).body.data[0].fields.姓名, '申请人');
    assert.equal((await request('/employees/U001/salary', admin, 'PUT', { base: 5000 })).status, 200);
    assert.equal((await request('/employees/U001/salary', admin)).body.data.base, 5000);
    const model = await request('/salary-model', admin, 'PUT', { version: 1, fixedFields: ['基础薪资', '固定补贴', '绩效薪资'], extendedFields: [] });
    assert.equal(model.status, 200);
    const modelVersion = model.body.data.version;
    const values = { 基础薪资: 6000, 固定补贴: 500, 绩效薪资: 1000 };
    assert.equal((await request('/employees/U001/salary', admin, 'PUT', { effectiveDate: '2026-11-01', values, modelVersion })).status, 200);
    const savedSalary = (await request('/employees/U001/salary', admin)).body.data;
    assert.deepEqual(savedSalary.values, values);
    assert.equal(savedSalary.base, 6000);
    assert.equal(savedSalary.allowance, 500);
    assert.equal(savedSalary.performance, 1000);
    assert.equal(savedSalary.modelVersion, modelVersion);
    const employeePosition = await pool.queryOne<{ position: string }>('SELECT position FROM employees WHERE id = ?', ['U001']);
    assert.equal(savedSalary.jobTitle, employeePosition?.position);
    assert.equal((await request('/employees/U001/salary', admin, 'PUT', { values: { 基础薪资: 6000 }, modelVersion })).status, 400);
    assert.equal((await request('/employees/U001/salary', admin, 'PUT', { values: { ...values, 额外字段: 1 }, modelVersion })).status, 400);
    assert.equal((await request('/employees/U001/salary', admin, 'PUT', { values, modelVersion: modelVersion - 1 })).status, 409);
    const history = (await request('/employees/U001/salary/history', admin)).body.data;
    assert.deepEqual(history[0].data.values, values);
    assert.equal(history[0].data.base, 6000);
    const beforeExtended = await pool.queryOne<{ data_json: string | Record<string, unknown> }>("SELECT data_json FROM hr_employee_records WHERE employee_id = 'U001' AND section = 'salary'");
    const extended = await request('/salary-model', admin, 'PUT', { version: modelVersion, fixedFields: ['基础薪资', '固定补贴', '绩效薪资'], extendedFields: ['额外字段'] });
    assert.equal(extended.status, 200);
    const afterExtended = await pool.queryOne<{ data_json: string | Record<string, unknown> }>("SELECT data_json FROM hr_employee_records WHERE employee_id = 'U001' AND section = 'salary'");
    assert.deepEqual(afterExtended?.data_json, beforeExtended?.data_json);
    assert.equal((await request('/employees/U001/salary', admin)).body.data.modelVersion, extended.body.data.version);
    const changed = await request('/salary-model', admin, 'PUT', { version: extended.body.data.version, fixedFields: ['基本工资', '绩效薪资', '餐补'], extendedFields: [] });
    assert.equal(changed.status, 200);
    const synced = (await request('/employees/U001/salary', admin)).body.data;
    assert.deepEqual(synced.values, { 基本工资: 0, 绩效薪资: 1000, 餐补: 0 });
    assert.equal(synced.base, 0);
    assert.equal(synced.allowance, null);
    assert.equal(synced.performance, 1000);
    const stored = await pool.queryOne<{ data_json: string | Record<string, unknown> }>("SELECT data_json FROM hr_employee_records WHERE employee_id = 'U001' AND section = 'salary'");
    const storedData = typeof stored!.data_json === 'string' ? JSON.parse(stored!.data_json) : stored!.data_json;
    assert.deepEqual(storedData.values, synced.values);
    const readded = await request('/salary-model', admin, 'PUT', { version: changed.body.data.version, fixedFields: ['基础薪资', '固定补贴', '绩效薪资'], extendedFields: [] });
    assert.equal(readded.status, 200);
    assert.deepEqual((await request('/employees/U001/salary', admin)).body.data.values, { 基础薪资: 0, 固定补贴: 0, 绩效薪资: 1000 });
    assert.ok((await request('/employees/U001/salary/history', admin)).body.data.some((entry: any) => entry.data.values?.基础薪资 === 6000));
    const concurrentVersion = readded.body.data.version;
    const [modelUpdate, salaryUpdate] = await Promise.all([
      request('/salary-model', admin, 'PUT', { version: concurrentVersion, fixedFields: ['基础薪资', '绩效薪资', '差旅补贴'], extendedFields: [] }),
      request('/employees/U001/salary', admin, 'PUT', { effectiveDate: '2026-11-01', values: { 基础薪资: 7000, 固定补贴: 100, 绩效薪资: 200 }, modelVersion: concurrentVersion }),
    ]);
    assert.equal(modelUpdate.status, 200);
    assert.ok([200, 409].includes(salaryUpdate.status));
    const afterConcurrent = (await request('/employees/U001/salary', admin)).body.data;
    assert.deepEqual(afterConcurrent.values, salaryUpdate.status === 200
      ? { 基础薪资: 7000, 绩效薪资: 200, 差旅补贴: 0 }
      : { 基础薪资: 0, 绩效薪资: 1000, 差旅补贴: 0 });
    assert.equal(afterConcurrent.modelVersion, modelUpdate.body.data.version);
    assert.equal((await request('/payroll', admin, 'POST', { employeeId: 'U001', month: '2026-10', amount: 4500, note: '' })).status, 200);
    assert.equal((await request('/payroll', admin)).body.data[0].month, '2026-10');
    assert.equal((await request('/payroll', admin, 'POST', { employeeId: 'U001', month: '2026-10', amount: 4500, note: '' })).status, 409);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
