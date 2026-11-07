import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('职务目录支持创建、分配、通讯录筛选及使用中保护', async () => {
  const database = `yunqi_titles_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/domains/employees/jobTitleService')).backfillJobTitles();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const employee = (await issueTokens('U001')).accessToken;
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any; message?: string } }; };
    const initial = await call('/admin/job-titles', admin); assert.equal(initial.status, 200); assert.ok(initial.body.data.some((title: any) => title.name));
    assert.equal((await call('/admin/job-titles', employee, 'POST', { name: '无权创建' })).status, 401);
    const createdTitle = await call('/admin/job-titles', admin, 'POST', { name: '测试职务' }); assert.equal(createdTitle.status, 200);
    assert.equal((await call('/admin/job-titles', admin, 'POST', { name: '测试职务' })).status, 409);
    const titleId = createdTitle.body.data.id;
    const salary = (await call('/admin/hr/employees/U001/salary', admin)).body.data;
    assert.equal((await call('/admin/hr/employees/U001/salary', admin, 'PUT', { ...salary, jobTitle: '测试职务' })).status, 200);
    assert.equal((await call('/admin/hr/employees/U001/salary', admin)).body.data.jobTitle, '测试职务');
    assert.equal((await call(`/admin/job-titles/${titleId}`, admin, 'DELETE')).status, 409);
    const filtered = await call(`/employees/groups?jobTitle=${encodeURIComponent('测试职务')}`, employee);
    assert.equal(filtered.status, 200); assert.deepEqual(filtered.body.data.flatMap((group: any) => group.list).map((item: any) => item.id), ['U001']);
    const catalog = await call('/job-titles', employee); assert.ok(catalog.body.data.some((item: any) => item.name === '测试职务' && item.count === 1));
    assert.equal((await call('/admin/hr/employees/U001/salary', admin, 'PUT', { ...salary, jobTitle: '不存在的职务' })).status, 400);
    assert.equal((await call('/admin/hr/employees/U001/salary', admin, 'PUT', salary)).status, 200);
    assert.equal((await call(`/admin/job-titles/${titleId}`, admin, 'DELETE')).status, 200);
    await (await import('../src/domains/employees/jobTitleService')).backfillJobTitles();
    assert.ok(!(await call('/admin/job-titles', admin)).body.data.some((title: any) => title.name === '测试职务'));
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
