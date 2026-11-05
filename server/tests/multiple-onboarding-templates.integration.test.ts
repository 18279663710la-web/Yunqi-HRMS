import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('旧模板保留、多模板独立编辑、默认模板用于新申请并保存快照', async () => {
  const database = `yunqi_templates_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.hr_settings (setting_key, value_json, updated_at) VALUES ('self_onboarding_template', ?, NOW())`, [JSON.stringify([{ name: '旧字段', type: 'text', required: true }])]);
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data: any } }; };
    const first = await call('/admin/onboarding-form/templates', admin); assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 1); assert.equal(first.body.data[0].fields[0].name, '旧字段'); assert.equal(first.body.data[0].isDefault, true);
    const createdTemplate = await call('/admin/onboarding-form/templates', admin, 'POST', { name: '新模板', fields: [{ name: '新字段', type: 'text', required: true }] }); assert.equal(createdTemplate.status, 200);
    const id = createdTemplate.body.data.id; const version = createdTemplate.body.data.version;
    assert.equal((await call(`/admin/onboarding-form/templates/${id}/default`, admin, 'PUT', {})).status, 200);
    assert.equal((await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U001', expectedDate: '2026-11-10' })).status, 200);
    assert.equal((await call(`/admin/onboarding-form/templates/${id}`, admin, 'PUT', { name: '已更改模板', fields: [{ name: '已更改', type: 'number', required: true }], version })).status, 200);
    const list = (await call('/admin/onboarding-form/templates', admin)).body.data;
    assert.equal(list.find((t: any) => t.id === id).fields[0].name, '已更改'); assert.equal(list.find((t: any) => t.id === id).name, '已更改模板'); assert.equal(list[0].fields[0].name, '旧字段');
    const { getEmployeeSessionVersion } = await import('../src/domains/accounts/employeeSessionService');
    const pending = await call('/onboarding-form/pending', issueTokens('U001', await getEmployeeSessionVersion('U001')).accessToken);
    assert.equal(pending.body.data.template[0].name, '新字段');
    assert.equal((await call('/admin/onboarding-form/templates/99999/default', admin, 'PUT', {})).status, 404);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
