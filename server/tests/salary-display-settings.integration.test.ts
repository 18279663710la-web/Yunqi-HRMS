import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('显示设置可保存、读取及修改，缺省为无且不改动员工定薪', async () => {
  const database = `yunqi_salary_display_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true; process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const call = async (method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api/admin/hr/salary-model`, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any; message?: string } }; };
    const original = (await call()).body.data;
    const first = await call('PUT', { version: original.version, fixedFields: [{ name: '基本工资', type: 'number' }], extendedFields: [{ name: '出勤天', type: 'number' }] });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.extendedFields[0].displaySetting ?? 'none', 'none');
    await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id,section,data_json,updated_at) VALUES ('U001','salary',?,NOW())`, [JSON.stringify({ effectiveDate: '2026-01-01', values: { 基本工资: 1000 }, base: 1000, modelVersion: first.body.data.version })]);
    const [before] = await conn.query(`SELECT data_json FROM \`${database}\`.hr_employee_records WHERE employee_id='U001' AND section='salary'`);
    const fixed = first.body.data.fixedFields.map((field: any) => field.name === '姓名' ? { ...field, displaySetting: 'display' } : field.name === '基本工资' ? { ...field, displaySetting: 'output' } : field);
    const updated = await call('PUT', { version: first.body.data.version, fixedFields: fixed, extendedFields: [{ ...first.body.data.extendedFields[0], displaySetting: 'display' }] });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.fixedFields[0].displaySetting, 'display');
    assert.equal(updated.body.data.fixedFields[3].displaySetting, 'output');
    assert.equal(updated.body.data.extendedFields[0].displaySetting, 'display');
    const reread = (await call()).body.data; assert.deepEqual(reread, updated.body.data);
    const [after] = await conn.query(`SELECT data_json FROM \`${database}\`.hr_employee_records WHERE employee_id='U001' AND section='salary'`); assert.deepEqual(after, before);
    const invalid = await call('PUT', { version: reread.version, fixedFields: reread.fixedFields, extendedFields: [{ ...reread.extendedFields[0], displaySetting: 'invalid' }] });
    assert.equal(invalid.status, 400);
    const cleared = await call('PUT', { version: reread.version, fixedFields: reread.fixedFields, extendedFields: [{ ...reread.extendedFields[0], displaySetting: 'none' }] });
    assert.equal(cleared.status, 200); assert.equal(cleared.body.data.extendedFields[0].displaySetting ?? 'none', 'none');
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
