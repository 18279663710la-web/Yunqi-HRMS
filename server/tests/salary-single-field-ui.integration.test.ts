import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { applySalaryFieldChange } from '../../web/src/modules/models-formulas/salary/salaryModel';

test('单字段创建、编辑和删除与定薪同步及字段顺序兼容', async () => {
  const database = `yunqi_salary_single_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true; process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const token = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: (await response.json() as { data?: any }).data };
    };
    let model = (await call('/salary-model')).data;
    const write = async (input: unknown) => { const response = await call('/salary-model', 'PUT', input); assert.equal(response.status, 200); return response.data; };
    model = await write(applySalaryFieldChange(model, { action: 'create', group: 'fixed', field: { name: '基本工资', type: 'number', required: true, category: 'income' } }));
    model = await write(applySalaryFieldChange(model, { action: 'create', group: 'extended', field: { name: '出勤天', type: 'number', required: true, category: 'info' } }));
    const order = ['出勤天', '姓名', '基本工资', '员工号', '职务'];
    model = await write({ ...model, fieldOrder: order });
    assert.equal((await call('/employees/U001/salary', 'PUT', { effectiveDate: '2026-01-01', modelVersion: model.version, values: { 基本工资: 4321 } })).status, 200);
    model = await write(applySalaryFieldChange(model, { action: 'edit', group: 'extended', name: '出勤天', field: { name: '考勤天数', type: 'number', required: true, category: 'info' } }));
    assert.deepEqual(model.fieldOrder, ['考勤天数', '姓名', '基本工资', '员工号', '职务']);
    assert.equal((await call('/employees/U001/salary')).data.values.基本工资, 4321);
    model = await write(applySalaryFieldChange(model, { action: 'delete', group: 'fixed', name: '基本工资' }));
    assert.deepEqual((await call('/employees/U001/salary')).data.values, {});
    assert.deepEqual(model.fieldOrder, ['考勤天数', '姓名', '员工号', '职务']);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
