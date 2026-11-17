import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('管理员打回后员工重新填写，完整历史保留且后台不可修改', async () => {
  const database = `yunqi_onboarding_edit_${randomBytes(8).toString('hex')}`;
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
    assert.equal((await call('/onboarding-form/submit', employeeToken, 'POST', { __onboardingFormat: 2, values: submitted, photo, signature, declarationAccepted: true })).status, 200);

    const directEdit = await call(`/admin/onboarding-form/applications/${applicationId}`, admin, 'PUT', { values: { ...submitted, 姓名: '管理员改名' } });
    assert.notEqual(directEdit.status, 200);
    const oldTemplates = (await call('/admin/onboarding-form/templates', admin)).body.data; const oldDefault = oldTemplates.find((item: any) => item.isDefault).id;
    const updatedFields = [...fields, { name: '籍贯', type: 'text', required: true }];
    const createdTemplate = await call('/admin/onboarding-form/templates', admin, 'POST', { name: '新版模板', fields: updatedFields });
    assert.equal(createdTemplate.status, 200); assert.equal((await call(`/admin/onboarding-form/templates/${createdTemplate.body.data.id}/default`, admin, 'PUT', {})).status, 200);
    const returns = await Promise.all([call(`/admin/onboarding-form/applications/${applicationId}/return`, admin, 'POST', {}), call(`/admin/onboarding-form/applications/${applicationId}/return`, admin, 'POST', {})]);
    assert.deepEqual(returns.map(r => r.status).sort(), [200, 400]);
    const history1 = await call(`/admin/onboarding-form/applications/${applicationId}/submissions`, admin); assert.equal(history1.status, 200);
    assert.deepEqual(history1.body.data[0].template, fields); assert.deepEqual(history1.body.data[0].answers.values, submitted); assert.equal(history1.body.data[0].answers.declarationAccepted, true); assert.equal(history1.body.data[0].answers.photo, photo); assert.equal(history1.body.data[0].answers.signature, signature);
    const pending = await call('/onboarding-form/pending', employeeToken); assert.deepEqual(pending.body.data.template, updatedFields); assert.deepEqual(pending.body.data.previous.values, submitted); assert.equal(pending.body.data.previous.photo, photo); assert.equal(pending.body.data.previous.signature, undefined);
    assert.equal((await call('/company', employeeToken)).status, 403);
    assert.equal((await call(`/admin/onboarding-form/templates/${oldDefault}/default`, admin, 'PUT', {})).status, 200);
    assert.deepEqual((await call('/onboarding-form/pending', employeeToken)).body.data.template, updatedFields);
    const second = { ...submitted, 籍贯: '上海', 姓名: '李四', 教育经历: [{ 学校: '学院', 年份: 2021 }] };
    assert.equal((await call('/onboarding-form/submit', employeeToken, 'POST', { __onboardingFormat: 2, values: second, declarationAccepted: false })).status, 400);
    assert.equal((await call('/onboarding-form/submit', employeeToken, 'POST', { __onboardingFormat: 2, values: second, signature, declarationAccepted: true })).status, 200);
    assert.equal((await call('/company', employeeToken)).status, 200);
    assert.equal((await call(`/admin/onboarding-form/applications/${applicationId}/return`, admin, 'POST', {})).status, 200);
    const history2 = (await call(`/admin/onboarding-form/applications/${applicationId}/submissions`, admin)).body.data;
    assert.equal(history2.length, 2); assert.deepEqual(history2[0].template, updatedFields); assert.deepEqual(history2[1].template, fields); assert.deepEqual(history2[0].answers.values, second); assert.deepEqual(history2[1].answers.values, submitted);
    assert.equal((await call(`/admin/onboarding-form/applications/${applicationId}/submissions`, employeeToken)).status, 401);
    assert.ok(Array.isArray((await call(`/admin/onboarding-form/applications/${applicationId}/history`, admin)).body.data));
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
