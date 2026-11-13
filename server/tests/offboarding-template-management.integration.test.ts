import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('离职申请表模板命名、删除、版本冲突与修改历史', async () => {
  const database = `yunqi_offboarding_tpl_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() as { data?: any; message?: string } };
    };
    const templateA = [{ name: '字段A', type: 'text', required: false }, { name: '离职原因', type: 'select', required: false, options: ['个人发展', '家庭原因'] }];
    const templateAOptions = [{ name: '字段A', type: 'text', required: false }, { name: '离职原因', type: 'select', required: false, options: ['个人发展', '家庭原因', '其他'] }];
    const templateB = [{ name: '字段B', type: 'text', required: false }];

    const first = await call('/admin/offboarding-form/templates', admin);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 1);
    assert.equal(first.body.data[0].name, '标准离职申请表');
    assert.equal(first.body.data[0].version, 1);
    assert.equal(first.body.data[0].isDefault, true);
    assert.ok(first.body.data[0].fields.some((field: any) => field.name === '离职原因' && field.type === 'select'));
    const initialId = first.body.data[0].id;

    const createdA = await call('/admin/offboarding-form/templates', admin, 'POST', { name: '模板A', fields: templateA });
    assert.equal(createdA.status, 200);
    const aId = createdA.body.data.id;
    assert.equal(createdA.body.data.version, 1);

    const renamed = await call(`/admin/offboarding-form/templates/${aId}`, admin, 'PUT', { name: '模板A改', fields: templateA, version: 1 });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.version, 2);
    assert.equal(renamed.body.data.changed, true);

    const optionsChanged = await call(`/admin/offboarding-form/templates/${aId}`, admin, 'PUT', { name: '模板A改', fields: templateAOptions, version: 2 });
    assert.equal(optionsChanged.status, 200);
    assert.equal(optionsChanged.body.data.version, 3);

    const noop = await call(`/admin/offboarding-form/templates/${aId}`, admin, 'PUT', { name: '模板A改', fields: templateAOptions, version: 3 });
    assert.equal(noop.status, 200);
    assert.equal(noop.body.data.changed, false);

    const stale = await call(`/admin/offboarding-form/templates/${aId}`, admin, 'PUT', { name: '旧版本保存', fields: templateAOptions, version: 1 });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message || '', /其他管理员修改/);

    const history = await call('/admin/offboarding-form/template-history', admin);
    assert.equal(history.status, 200);
    const entries = history.body.data as any[];
    assert.ok(entries.some(entry => entry.templateId === aId && entry.action === 'create' && entry.after.name === '模板A'));
    const updateEntry = entries.find(entry => entry.templateId === aId && entry.action === 'update' && entry.changes.some((change: any) => change.label === '模板名称'));
    assert.ok(updateEntry);
    assert.equal(updateEntry.before.name, '模板A');
    assert.equal(updateEntry.after.name, '模板A改');
    const optionEntry = entries.find(entry => entry.templateId === aId && entry.action === 'update' && entry.changes.some((change: any) => change.label === '字段 2 选项'));
    assert.ok(optionEntry);
    assert.ok(optionEntry.changes.some((change: any) => change.label === '字段 2 选项' && change.before === '个人发展、家庭原因' && change.after === '个人发展、家庭原因、其他'));

    const deleteDefault = await call(`/admin/offboarding-form/templates/${initialId}`, admin, 'DELETE');
    assert.equal(deleteDefault.status, 400);
    assert.match(deleteDefault.body.message || '', /现用模板/);
    assert.equal((await call(`/admin/offboarding-form/templates/${aId}/default`, admin, 'PUT', {})).status, 200);
    assert.equal((await call(`/admin/offboarding-form/templates/${initialId}`, admin, 'DELETE')).status, 200);
    const afterDelete = (await call('/admin/offboarding-form/templates', admin)).body.data as any[];
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete.some(template => template.id === initialId), false);
    const afterReload = (await call('/admin/offboarding-form/templates', admin)).body.data as any[];
    assert.equal(afterReload.some(template => template.id === initialId), false, '删除模板后不应被 GET 重新创建');
    const deleteLast = await call(`/admin/offboarding-form/templates/${aId}`, admin, 'DELETE');
    assert.equal(deleteLast.status, 400);
    assert.match(deleteLast.body.message || '', /至少保留/);

    const createdB = await call('/admin/offboarding-form/templates', admin, 'POST', { name: '模板B', fields: templateB });
    assert.equal(createdB.status, 200);
    const bId = createdB.body.data.id;
    assert.equal((await call(`/admin/offboarding-form/templates/${bId}/default`, admin, 'PUT', {})).status, 200);
    assert.equal((await call(`/admin/offboarding-form/templates/${aId}`, admin, 'DELETE')).status, 200);
    const deletedHistory = (await call('/admin/offboarding-form/template-history', admin)).body.data as any[];
    const deleteEntry = deletedHistory.find(entry => entry.templateId === aId && entry.action === 'delete');
    assert.ok(deleteEntry);
    assert.equal(deleteEntry.before.name, '模板A改');
    assert.equal(deleteEntry.after, null);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
