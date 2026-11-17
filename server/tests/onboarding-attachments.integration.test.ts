import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('入职附件支持普通及表格字段，按员工和申请隔离并保留历史', async () => {
  const database = `yunqi_onboarding_files_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username,password_hash,name,role,status,created_at) VALUES ('files_hr','x','HR','hr_admin',1,NOW())`);
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const { getEmployeeSessionVersion } = await import('../src/domains/accounts/employeeSessionService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const base = `http://127.0.0.1:${addr.port}/api`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hr = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const employee = issueTokens('U001', await getEmployeeSessionVersion('U001')).accessToken;
    const other = issueTokens('U012', await getEmployeeSessionVersion('U012')).accessToken;
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => {
      const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() as { data?: any; message?: string } };
    };
    const fields = [{ name: '资料', type: 'attachment', required: true }, { name: '经历', type: 'table', required: true, children: [{ name: '证明', type: 'attachment', required: true }] }];
    const template = await call('/admin/onboarding-form/templates', admin, 'POST', { name: '附件模板', fields }); assert.equal(template.status, 200);
    assert.equal((await call(`/admin/onboarding-form/templates/${template.body.data.id}/default`, admin, 'PUT', {})).status, 200);
    const application = await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U001', expectedDate: '2026-11-10' }); assert.equal(application.status, 200);
    const otherApplication = await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U012', expectedDate: '2026-11-10' }); assert.equal(otherApplication.status, 200);
    const upload = async (token: string, field: string, child?: string) => {
      const form = new FormData(); form.set('field', field); if (child) form.set('child', child); form.set('file', new Blob(['test attachment'], { type: 'text/plain' }), '证明.txt');
      const res = await fetch(base + '/onboarding-form/attachments', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }); return { status: res.status, body: await res.json() as { data?: any } };
    };
    assert.equal((await upload(employee, '未知')).status, 400);
    const oversized = new FormData(); oversized.set('field', '资料'); oversized.set('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'large.bin');
    assert.equal((await fetch(base + '/onboarding-form/attachments', { method: 'POST', headers: { Authorization: `Bearer ${employee}` }, body: oversized })).status, 400);
    const first = await upload(employee, '资料'); assert.equal(first.status, 200);
    let latest = first;
    for (let index = 0; index < 4; index += 1) { latest = await upload(employee, '资料'); assert.equal(latest.status, 200); }
    assert.equal((await upload(employee, '资料')).status, 400);
    assert.equal((await call(`/onboarding-form/attachments/${latest.body.data.id}`, employee, 'DELETE')).status, 200);
    const replaced = await upload(employee, '资料'); assert.equal(replaced.status, 200);
    assert.equal((await call(`/onboarding-form/attachments/${first.body.data.id}`, other, 'DELETE')).status, 404);
    const second = await upload(employee, '经历', '证明'); assert.equal(second.status, 200);
    for (let index = 0; index < 5; index += 1) assert.equal((await upload(employee, '经历', '证明')).status, 200);
    const foreign = await upload(other, '资料'); assert.equal(foreign.status, 200);
    const signature = 'data:image/png;base64,iVBORw0KGgo=';
    const submit = (资料: unknown, 证明: unknown) => call('/onboarding-form/submit', employee, 'POST', { __onboardingFormat: 2, values: { 资料, 经历: [{ 证明 }] }, signature, declarationAccepted: true });
    assert.equal((await submit([], [second.body.data])).status, 400);
    assert.equal((await submit([foreign.body.data], [second.body.data])).status, 400);
    assert.equal((await submit([second.body.data], [first.body.data])).status, 400);
    assert.equal((await submit([{ ...first.body.data, name: '伪造文件.txt' }], [second.body.data])).status, 400);
    assert.equal((await submit([first.body.data, first.body.data], [second.body.data])).status, 400);
    assert.equal((await submit([first.body.data], [second.body.data])).status, 200);
    assert.notEqual((await upload(employee, '资料')).status, 200);
    const downloadPath = `/admin/onboarding-form/attachments/${first.body.data.id}`;
    const download = await fetch(base + downloadPath, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(download.status, 200); assert.equal(await download.text(), 'test attachment'); assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(base + downloadPath, { headers: { Authorization: `Bearer ${other}` } })).status, 401);
    assert.equal((await fetch(base + downloadPath, { headers: { Authorization: `Bearer ${hr}` } })).status, 403);
    assert.equal((await call(`/admin/onboarding-form/applications/${application.body.data.id}/return`, admin, 'POST', {})).status, 200);
    const pending = await call('/onboarding-form/pending', employee); assert.deepEqual(pending.body.data.previous.values.资料, [first.body.data]);
    const afterReturn = await upload(employee, '资料'); assert.equal(afterReturn.status, 200);
    assert.equal((await call(`/onboarding-form/attachments/${first.body.data.id}`, employee, 'DELETE')).status, 200);
    assert.equal((await fetch(base + downloadPath, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
    const history = await call(`/admin/onboarding-form/applications/${application.body.data.id}/submissions`, admin); assert.deepEqual(history.body.data[0].answers.values.资料, [first.body.data]);
    assert.equal((await submit([first.body.data], [second.body.data])).status, 200);
    assert.equal((await call(`/admin/onboarding-form/applications/${application.body.data.id}/archive`, admin, 'POST', {})).status, 200);
    assert.equal((await fetch(base + downloadPath, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
