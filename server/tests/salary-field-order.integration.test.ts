import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('排序持久化、校验并发、兼容模型字段变更且不重写定薪', async () => {
  const database = `yunqi_salary_order_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true; process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const token = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/hr${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: (await response.json() as { data?: any }).data };
    };
    const initial = (await call('/salary-model')).data;
    const createdModel = await call('/salary-model', 'PUT', { version: initial.version, fixedFields: [{ name: '基本工资' }], extendedFields: [{ name: '出勤天' }] });
    assert.equal(createdModel.status, 200);
    let model = createdModel.data;
    const salary = await call('/employees/U001/salary', 'PUT', { effectiveDate: '2026-01-01', modelVersion: model.version, values: { 基本工资: 4321 } });
    assert.equal(salary.status, 200);
    const before = await pool.queryOne<{ data_json: unknown; updated_at: Date }>("SELECT data_json, updated_at FROM hr_employee_records WHERE employee_id = 'U001' AND section = 'salary'");
    const order = ['出勤天', '基本工资', '姓名', '员工号', '职务'];
    const input = { version: model.version, fixedFields: model.fixedFields, extendedFields: model.extendedFields, fieldOrder: order };
    assert.equal((await call('/salary-model', 'PUT', { ...input, fieldOrder: ['姓名', '姓名'] })).status, 400);
    const reordered = await call('/salary-model', 'PUT', input);
    assert.equal(reordered.status, 200); model = reordered.data;
    assert.deepEqual(model.fieldOrder, order);
    assert.deepEqual((await call('/salary-model')).data.fieldOrder, order);
    assert.equal((await call('/salary-model', 'PUT', input)).status, 409);
    const after = await pool.queryOne<{ data_json: unknown; updated_at: Date }>("SELECT data_json, updated_at FROM hr_employee_records WHERE employee_id = 'U001' AND section = 'salary'");
    assert.deepEqual(after, before);
    const changed = await call('/salary-model', 'PUT', { version: model.version, fixedFields: model.fixedFields, extendedFields: [{ name: '餐补' }] });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.data.fieldOrder, ['基本工资', '姓名', '员工号', '职务', '餐补']);
    assert.deepEqual((await call('/salary-model')).data.fieldOrder, changed.data.fieldOrder);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
