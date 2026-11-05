import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('封存入职申请后可只读查看，禁止打回和修改', async () => {
  const database = `yunqi_onboarding_edit_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any; message?: string } }; };

    const fields = [
      { name: '姓名', type: 'text', required: true, maxLength: 10 },
      { name: '性别', type: 'select', required: true, options: ['男', '女'] },
      { name: '年龄', type: 'number', required: true, min: 18, max: 60 },
      { name: '入职日期', type: 'date', required: true },
      { name: '教育经历', type: 'table', required: true, children: [
        { name: '学校', type: 'text', required: true, maxLength: 20 },
        { name: '年份', type: 'number', required: false, min: 1900 },
      ] },
    ];
    assert.equal((await call('/admin/onboarding-form/templates', admin, 'POST', { name: '编辑测试模板', fields })).status, 200);
    const registration = await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U001', expectedDate: '2026-11-10' });
    assert.equal(registration.status, 200);
    const applicationId = registration.body.data.id;
    const { getEmployeeSessionVersion } = await import('../src/domains/accounts/employeeSessionService');
    const employeeToken = issueTokens('U001', await getEmployeeSessionVersion('U001')).accessToken;
    const submitted = { 姓名: '张三', 性别: '男', 年龄: 30, 入职日期: '2026-11-01', 教育经历: [{ 学校: '大学', 年份: 2020 }] };
    const photo = 'data:image/jpeg;base64,/9j/2Q=='; const signature = 'data:image/png;base64,iVBORw0KGgo=';
    const archivedBefore = await call('/admin/onboarding-form/archived/U001', admin); assert.equal(archivedBefore.status, 200); assert.equal(archivedBefore.body.data, null);
    const pendingArchive = await call(`/admin/onboarding-form/applications/${applicationId}/archive`, admin, 'POST', {}); assert.equal(pendingArchive.status, 400);
    assert.equal((await call('/onboarding-form/submit', employeeToken, 'POST', { __onboardingFormat: 2, values: submitted, photo, signature, declarationAccepted: true })).status, 200);
    assert.equal((await call('/admin/onboarding-form/archived/U001', admin)).body.data, null);
    const archived = await call(`/admin/onboarding-form/applications/${applicationId}/archive`, admin, 'POST', {}); assert.equal(archived.status, 200);
    const profile = await call('/admin/onboarding-form/archived/U001', admin); assert.equal(profile.status, 200); assert.deepEqual(profile.body.data.template, fields); assert.deepEqual(profile.body.data.answers, submitted);
    assert.equal(profile.body.data.signature, signature); assert.equal(profile.body.data.photo, photo); assert.equal(profile.body.data.declarationAccepted, true); assert.ok(profile.body.data.archivedAt);
    const list = (await call('/admin/onboarding-form/applications', admin)).body.data as any[]; assert.ok(list.find(item => item.id === applicationId).archivedAt);
    assert.notEqual((await call(`/admin/onboarding-form/applications/${applicationId}/return`, admin, 'POST', {})).status, 200);
    assert.notEqual((await call(`/admin/onboarding-form/applications/${applicationId}/archive`, admin, 'POST', {})).status, 200);
    assert.notEqual((await call('/onboarding-form/submit', employeeToken, 'POST', { __onboardingFormat: 2, values: submitted, signature, declarationAccepted: true })).status, 200);
    assert.notEqual((await call('/admin/hr/employees/U001/profile', admin, 'PUT', { address:'test' })).status, 200);
    assert.equal((await call('/admin/onboarding-form/archived/U001', employeeToken)).status, 401);
    assert.deepEqual((await call('/admin/onboarding-form/archived/U001', admin)).body.data.answers, submitted);
    const another = await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U005', expectedDate: '2026-11-10' }); assert.equal(another.status, 200);
    const secondId = another.body.data.id; const secondToken = issueTokens('U005', await getEmployeeSessionVersion('U005')).accessToken;
    assert.equal((await call('/onboarding-form/submit', secondToken, 'POST', { __onboardingFormat: 2, values: submitted, signature, declarationAccepted: true })).status, 200);
    const race = await Promise.all([call(`/admin/onboarding-form/applications/${secondId}/archive`, admin, 'POST', {}), call(`/admin/onboarding-form/applications/${secondId}/return`, admin, 'POST', {})]);
    assert.deepEqual(race.map(result => result.status).sort(), [200, 400]);
    const secondProfile = (await call('/admin/onboarding-form/archived/U005', admin)).body.data;
    const secondPending = (await call('/onboarding-form/pending', secondToken)).body.data;
    assert.equal(!!secondProfile, !secondPending);

  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
