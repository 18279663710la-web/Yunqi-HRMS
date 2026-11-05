import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('管理员登记后仅对应员工填写模板快照并可查看结果', async () => {
  const database = `yunqi_self_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.employee_accounts (employee_id, login_name, password_hash, status, created_at, updated_at) VALUES ('U001','testone','x','active',NOW(),NOW()), ('U005','testtwo','x','active',NOW(),NOW()) ON DUPLICATE KEY UPDATE status = 'active'`);
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data: any } }; };
    const { getEmployeeSessionVersion } = await import('../src/domains/accounts/employeeSessionService');
    const one = issueTokens('U001', await getEmployeeSessionVersion('U001')).accessToken; const two = issueTokens('U005', await getEmployeeSessionVersion('U005')).accessToken;
    const template = [{ name: '地址', type: 'text', required: true, maxLength: 8 }, { name: '教育经历', type: 'table', required: true, children: [{ name: '学校', type: 'text', required: true }, { name: '年份', type: 'number', required: false, min: 1900 }] }];
    assert.equal((await call('/admin/onboarding-form/template', admin, 'PUT', template)).status, 200);
    assert.equal((await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U001', expectedDate: '2026-11-10' })).status, 200);
    const blocked = await call('/company', one); assert.equal(blocked.status, 403); assert.equal((blocked.body as { code?: number }).code, 40301);
    assert.equal((await call('/me', one)).status, 200);
    assert.equal((await call('/company', two)).status, 200);
    assert.equal((await call('/admin/onboarding-form/applications', admin, 'POST', { employeeId: 'U001', expectedDate: '2026-11-10' })).status, 400);
    assert.equal((await call('/admin/onboarding-form/template', admin, 'PUT', [{ name: '工龄', type: 'number', required: true }])).status, 200);
    const otherPending = await call('/onboarding-form/pending', two); assert.equal(otherPending.status, 200, JSON.stringify(otherPending.body)); assert.equal(otherPending.body.data, null);
    assert.equal((await call('/onboarding-form/pending', one)).body.data.template[0].name, '地址');
    assert.equal((await call('/onboarding-form/submit', one, 'POST', { 地址: '' })).status, 400);
    assert.equal((await call('/onboarding-form/submit', two, 'POST', { 地址: '上海' })).status, 404);
    assert.equal((await call('/onboarding-form/submit', one, 'POST', { 地址: '上海', 教育经历: [{ 学校: '' }] })).status, 400);
    const values = { 地址: '上海', 教育经历: [{ 学校: '大学', 年份: 2020 }] };
    for (const payload of [{ __onboardingFormat: 2, values, declarationAccepted: false }, { __onboardingFormat: 2, values }, values]) {
      const result = await call('/onboarding-form/submit', one, 'POST', payload);
      assert.equal(result.status, 400); assert.match((result.body as { message?: string }).message || '', /同意声明/);
      assert.ok((await call('/onboarding-form/pending', one)).body.data);
    }
    const photo = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400000)]).toString('base64')}`; const signature = 'data:image/png;base64,iVBORw0KGgo=';
    for (const missingSignature of [undefined, null, '']) {
      const result = await call('/onboarding-form/submit', one, 'POST', { __onboardingFormat: 2, values, declarationAccepted: true, signature: missingSignature });
      assert.equal(result.status, 400); assert.match((result.body as { message?: string }).message || '', /签名/);
      assert.ok((await call('/onboarding-form/pending', one)).body.data);
    }
    assert.equal((await call('/onboarding-form/submit', one, 'POST', { __onboardingFormat: 2, values: { 地址: '上海', 教育经历: [{ 学校: '大学', 年份: 2020 }, { 学校: '学院' }] }, photo: 'invalid', signature })).status, 400);
    assert.equal((await call('/onboarding-form/submit', one, 'POST', { __onboardingFormat: 2, values: { 地址: '上海', 教育经历: [{ 学校: '大学', 年份: 2020 }, { 学校: '学院' }] }, photo, signature, declarationAccepted: true })).status, 200);
    assert.equal((await call('/onboarding-form/pending', one)).body.data, null);
    assert.equal((await call('/company', one)).status, 200);
    await conn.query(`ANALYZE TABLE \`${database}\`.employees, \`${database}\`.employee_accounts, \`${database}\`.hr_self_onboarding`);
    const applications = await call('/admin/onboarding-form/applications', admin); assert.equal(applications.status, 200);
    const application = applications.body.data[0]; const answers = application.answers;
    assert.equal(answers.地址, '上海'); assert.deepEqual(answers.教育经历, [{ 学校: '大学', 年份: 2020 }, { 学校: '学院' }]);
    assert.equal(application.photo, photo); assert.equal(application.signature, signature);
    assert.equal(application.declarationAccepted, true); assert.match(application.declaration, /本人保证所填写的上述信息真实/);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
