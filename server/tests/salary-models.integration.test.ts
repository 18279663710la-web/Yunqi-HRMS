import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('薪资构成模型固定姓名、员工号、职务并支持金额字段', async () => {
  const database = `yunqi_salary_models_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    await pool.execute("INSERT INTO admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'unused', '测试', 'hr_admin', 1, NOW())");
    const hrAdmin = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const call = async (method = 'GET', body?: unknown, token = admin) => {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/admin/hr/salary-model`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, data: (await res.json() as { data?: any }).data };
    };
    const identity = [
      { name: '姓名', type: 'text', required: true, role: 'name' },
      { name: '员工号', type: 'text', required: true, role: 'employeeNo' },
      { name: '职务', type: 'text', required: true, role: 'position' },
    ];

    assert.deepEqual((await call()).data, { version: 1, fixedFields: identity, extendedFields: [] });
    assert.equal((await call('GET', undefined, hrAdmin)).status, 403);
    assert.equal((await call('PUT', { version: 1, fixedFields: [], extendedFields: [] }, hrAdmin)).status, 403);
    assert.equal((await call('GET', undefined, '')).status, 401);

    const identityOnly = await call('PUT', { version: 1, fixedFields: [], extendedFields: [] });
    assert.equal(identityOnly.status, 200);
    assert.equal(identityOnly.data.version, 2);
    assert.deepEqual(identityOnly.data.fixedFields, identity);
    assert.deepEqual(identityOnly.data.extendedFields, []);

    assert.equal((await call('PUT', { version: 2, fixedFields: ['工资', ' 工资 '], extendedFields: [] })).status, 400);
    assert.equal((await call('PUT', { version: 2, fixedFields: [{ name: '工资', type: 'text', category: 'income', required: true }], extendedFields: [] })).status, 400);

    const made = await call('PUT', { version: 2, fixedFields: ['基本工资', '绩效'], extendedFields: [] });
    assert.equal(made.status, 200);
    assert.equal(made.data.version, 3);
    assert.deepEqual(made.data.fixedFields, [
      ...identity,
      { name: '基本工资', type: 'number', required: true, role: 'base' },
      { name: '绩效', type: 'number', required: true },
    ]);
    assert.deepEqual(made.data.extendedFields, []);
    assert.deepEqual((await call()).data, made.data);

    const extended = await call('PUT', { version: 3, fixedFields: [{ name: '基本工资', type: 'number', required: true }], extendedFields: [{ name: '补贴', type: 'number', required: false }] });
    assert.equal(extended.status, 200);
    assert.equal(extended.data.version, 4);
    assert.deepEqual(extended.data.fixedFields, [...identity, { name: '基本工资', type: 'number', required: true, role: 'base' }]);
    assert.deepEqual(extended.data.extendedFields, [{ name: '补贴', type: 'number', required: false, category: 'info' }]);
    assert.deepEqual((await call()).data, extended.data);

    assert.equal((await call('PUT', { version: 3, fixedFields: ['旧版本'], extendedFields: [] })).status, 409);
    assert.equal((await call('PUT', { version: 4, fixedFields: [{ name: '基本工资' }], extendedFields: [{ name: ' 基本工资 ' }] })).status, 400);
    assert.equal((await call('PUT', { version: 4, fixedFields: [{ name: '基本工资' }], extendedFields: [{ name: '姓名' }] })).status, 400);
    assert.equal((await call('PUT', { version: 4, fixedFields: [], extendedFields: [{ name: '职务' }] })).status, 400);

    const protectedFields = await call('PUT', { version: 4, fixedFields: [{ name: '别名', role: 'name' }, { name: '员工号' }, { name: '基本工资' }], extendedFields: [] });
    assert.equal(protectedFields.status, 200);
    assert.equal(protectedFields.data.version, 5);
    assert.deepEqual(protectedFields.data.fixedFields, [...identity, { name: '基本工资', type: 'number', required: true, role: 'base' }]);

    const fortyEight = Array.from({ length: 48 }, (_, index) => ({ name: `字段${index + 1}`, type: 'number', required: true }));
    const maxModel = await call('PUT', { version: 5, fixedFields: fortyEight, extendedFields: [] });
    assert.equal(maxModel.status, 200);
    assert.equal(maxModel.data.version, 6);
    assert.equal(maxModel.data.fixedFields.length, 51);
    assert.equal((await call('PUT', { version: 6, fixedFields: [...fortyEight, { name: '字段49' }], extendedFields: [] })).status, 400);

    await pool.execute('DELETE FROM hr_settings WHERE setting_key = ?', ['salary_component_model']);
    const legacy = [
      { id: 'old-1', name: '旧模型', version: 9, fields: ['姓名', { name: '基础薪资', type: 'number', required: true }, '固定补贴', '绩效薪资'] },
      { id: 'old-2', name: '第二份模型', version: 1, fields: ['不应出现'] },
    ];
    await pool.execute('INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)', ['salary_component_models', JSON.stringify(legacy)]);
    const migrated = await call();
    assert.deepEqual(migrated.data, {
      version: 1,
      fixedFields: [
        ...identity,
        { name: '基础薪资', type: 'number', required: true, role: 'base' },
        { name: '固定补贴', type: 'number', required: true, role: 'allowance' },
        { name: '绩效薪资', type: 'number', required: true, role: 'performance' },
      ],
      extendedFields: [],
    });
    const migratedSave = await call('PUT', { version: 1, fixedFields: migrated.data.fixedFields, extendedFields: [{ name: '新增扩展' }] });
    assert.equal(migratedSave.status, 200);
    assert.equal(migratedSave.data.version, 2);
    const legacyRow = await pool.queryOne<{ value_json: unknown }>('SELECT value_json FROM hr_settings WHERE setting_key = ?', ['salary_component_models']);
    const legacyStored = typeof legacyRow!.value_json === 'string' ? JSON.parse(legacyRow!.value_json) : legacyRow!.value_json;
    assert.equal((legacyStored as unknown[]).length, 2);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
