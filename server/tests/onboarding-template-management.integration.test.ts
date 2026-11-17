import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('模板命名、删除、版本冲突、内容审计与删除后快照可用', async () => {
  const database = `yunqi_template_mgmt_${randomBytes(8).toString('hex')}`;
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
    const templateA = [{ name: '字段A', type: 'text', required: false }, { name: '性别', type: 'select', required: false, options: ['男', '女'] }];
    const templateAOptions = [{ name: '字段A', type: 'text', required: false }, { name: '性别', type: 'select', required: false, options: ['男', '女', '其他'] }];
    const templateB = [{ name: '字段B', type: 'text', required: false }];
    const templateC = [{ name: '字段C', type: 'text', required: false }];

    const first = await call('/admin/onboarding-form/templates', admin);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 1);
    assert.equal(first.body.data[0].name, '标准入职申请表');
    assert.equal(first.body.data[0].version, 1);
    assert.equal(first.body.data[0].isDefault, true);
    const initialId = first.body.data[0].id;

    const createdA = await call('/admin/onboarding-form/templates', admin, 'POST', { name: '模板A', fields: templateA });
    assert.equal(createdA.status, 200);
    const aId = createdA.body.data.id;
    assert.equal(createdA.body.data.version, 1);
    const listA = (await call('/admin/onboarding-form/templates', admin)).body.data;
    assert.equal(listA.find((t: any) => t.id === aId).isDefault, false);

    const renamed = await call(`/admin/onboarding-form/templates/${aId}`, admin, 'PUT', { name: '模板A改', fields: templateA, version: 1 });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.version, 2);
    assert.equal(renamed.body.data.changed, true);

    const optionsChanged = await call(`/admin/onboarding-form/templates/${aId}`, admin, 'PUT', { name: '模板A改', fields: templateAOptions, version: 2 });
    assert.equal(optionsChanged.status, 200);
    assert.equal(optionsChanged.body.data.version, 3);
    assert.equal(optionsChanged.body.data.changed, true);

    const noop = await call(`/admin/onboarding-form/templates/${aId}`, admin, 'PUT', { name: '模板A改', fields: templateAOptions, version: 3 });
    assert.equal(noop.status, 200);
    assert.equal(noop.body.data.changed, false);
    assert.equal(noop.body.data.version, 3);

    const stale = await call(`/admin/onboarding-form/templates/${aId}`, admin, 'PUT', { name: '旧版本保存', fields: templateAOptions, version: 1 });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message || '', /其他管理员修改/);

    const history = await call('/admin/onboarding-form/template-history', admin);
    assert.equal(history.status, 200);
    const entries = history.body.data as any[];
    assert.ok(entries.some(entry => entry.templateId === aId && entry.action === 'create' && entry.after.name === '模板A'));
    const updateEntry = entries.find(entry => entry.templateId === aId && entry.action === 'update' && entry.changes.some((change: any) => change.label === '模板名称'));
    assert.ok(updateEntry);
    assert.equal(updateEntry.adminName, '系统管理员');
    assert.equal(updateEntry.before.name, '模板A');
    assert.equal(updateEntry.after.name, '模板A改');
    assert.ok(updateEntry.changes.some((change: any) => change.label === '模板名称' && change.before === '模板A' && change.after === '模板A改'));
    const optionEntry = entries.find(entry => entry.templateId === aId && entry.action === 'update' && entry.changes.some((change: any) => change.label === '字段 2 选项'));
    assert.ok(optionEntry);
    assert.ok(optionEntry.changes.some((change: any) => change.label === '字段 2 选项' && change.before === '男、女' && change.after === '男、女、其他'));

    const deleteDefault = await call(`/admin/onboarding-form/templates/${initialId}`, admin, 'DELETE');
    assert.equal(deleteDefault.status, 400);
    assert.match(deleteDefault.body.message || '', /现用模板/);
    assert.equal((await call(`/admin/onboarding-form/templates/${aId}/default`, admin, 'PUT', {})).status, 200);
    assert.equal((await call(`/admin/onboarding-form/templates/${initialId}`, admin, 'DELETE')).status, 200);
    const afterDelete = (await call('/admin/onboarding-form/templates', admin)).body.data as any[];
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete.some(template => template.id === initialId), false);
    const afterReload = (await call('/admin/onboarding-form/templates', admin)).body.data as any[];
    assert.equal(afterReload.some(template => template.id === initialId), false, '删除模板 1 后不应被 GET 重新创建');
    const deleteLast = await call(`/admin/onboarding-form/templates/${aId}`, admin, 'DELETE');
    assert.equal(deleteLast.status, 400);
    assert.match(deleteLast.body.message || '', /至少保留/);

    const createdB = await call('/admin/onboarding-form/templates', admin, 'POST', { name: '模板B', fields: templateB });
    const bId = createdB.body.data.id;
    const createdC = await call('/admin/onboarding-form/templates', admin, 'POST', { name: '模板C', fields: templateC });
    const cId = createdC.body.data.id;
    assert.equal((await call(`/admin/onboarding-form/templates/${bId}/default`, admin, 'PUT', {})).status, 200);
    const registration = await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U001', expectedDate: '2026-11-10' });
    assert.equal(registration.status, 200);
    assert.equal((await call(`/admin/onboarding-form/templates/${cId}/default`, admin, 'PUT', {})).status, 200);
    assert.equal((await call(`/admin/onboarding-form/templates/${bId}`, admin, 'DELETE')).status, 200);

    const { getEmployeeSessionVersion } = await import('../src/domains/accounts/employeeSessionService');
    const pending = await call('/onboarding-form/pending', issueTokens('U001', await getEmployeeSessionVersion('U001')).accessToken);
    assert.equal(pending.status, 200);
    assert.equal(pending.body.data.template[0].name, '字段B');

    const deletedHistory = (await call('/admin/onboarding-form/template-history', admin)).body.data as any[];
    const deleteEntry = deletedHistory.find(entry => entry.templateId === bId && entry.action === 'delete');
    assert.ok(deleteEntry);
    assert.equal(deleteEntry.before.name, '模板B');
    assert.equal(deleteEntry.before.fields[0].name, '字段B');
    assert.equal(deleteEntry.after, null);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
