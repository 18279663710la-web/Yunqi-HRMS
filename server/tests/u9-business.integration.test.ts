import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import express from 'express';

test('仅绑定的业务员能访问对应 U9 数据，管理员绑定不可重用', async () => {
  const database = `yunqi_u9_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username,password_hash,name,role,status,created_at) VALUES ('u9_hr','x','HR','hr_admin',1,NOW())`);
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const operators = [{ id: '101', code: 'A', name: '同名', orgId: '1', orgName: '一部' }, { id: '102', code: 'B', name: '同名', orgId: '2', orgName: '二部' }];
    const fakeU9 = {
      searchOperators: async () => operators,
      getOperator: async (id: string) => operators.find(row => row.id === id) || null,
      listDocuments: async (_kind: string, operatorId: string) => [{ id: operatorId === '101' ? '201' : '202', docNo: `单据-${operatorId}` }],
      getDocument: async (_kind: string, operatorId: string, id: string) => id === (operatorId === '101' ? '201' : '202') ? { id, docNo: `单据-${operatorId}`, lines: [] } : null,
      getSummary: async (operatorId: string, from: string, to: string) => [{ CustomerCode: operatorId, CustomerName: '测试客户', DisplayName: from, UnRecMoney: '12.340000000', CurrencyName: '人民币', to }],
    };
    const { createU9AdminRouter } = await import('../src/admin/employees/u9Routes');
    const { createU9BusinessRouter } = await import('../src/miniprogram/business/u9Routes');
    const { requireAdmin } = await import('../src/admin/admin-accounts/authMiddleware');
    const { errorHandler } = await import('../src/shared/middleware/error');
    const app = express(); app.use(express.json()); app.use('/api/admin/u9', requireAdmin, createU9AdminRouter(fakeU9)); app.use('/api/business', createU9BusinessRouter(fakeU9)); app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hr = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const salesA = issueTokens('U012').accessToken; const salesB = issueTokens('U013').accessToken; const staff = issueTokens('U001').accessToken;
    async function call(path: string, token: string, method = 'GET', body?: unknown) { const res = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json() as { data?: any; message?: string } }; }
    assert.equal((await call('/admin/u9/operators', hr)).status, 403);
    assert.equal((await call('/admin/u9/bindings/U012', hr, 'PUT', { operatorId: '101' })).status, 403);
    assert.equal((await call('/admin/u9/bindings/U001', admin, 'PUT', { operatorId: '101' })).status, 400);
    assert.equal((await call('/admin/u9/bindings/U012', admin, 'PUT', { operatorId: '999' })).status, 400);
    assert.equal((await call('/business/receivables', staff)).status, 403);
    assert.equal((await call('/business/receivables', salesA)).status, 403);
    assert.equal((await call('/admin/u9/bindings/U012', admin, 'PUT', { operatorId: '101' })).status, 200);
    assert.equal((await call('/admin/u9/bindings/U013', admin, 'PUT', { operatorId: '101' })).status, 409);
    assert.equal((await call('/admin/u9/bindings/U013', admin, 'PUT', { operatorId: '102' })).status, 200);
    assert.deepEqual((await call('/business/receivables', salesA)).body.data.map((row: any) => row.id), ['201']);
    assert.deepEqual((await call('/business/receivables', salesB)).body.data.map((row: any) => row.id), ['202']);
    assert.equal((await call('/business/receivables/202', salesA)).status, 404);
    assert.equal((await call('/business/receivables?operatorId=102', salesA)).status, 400);
    assert.equal((await call('/business/summary/pdf?from=2025-01&to=2025-12&operatorId=102', salesA)).status, 400);
    assert.equal((await call('/business/summary/pdf?from=2025-12&to=2025-01', salesA)).status, 400);
    for (const path of ['/business/receivables/201/pdf', '/business/summary/pdf?from=2025-01&to=2025-12']) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { headers: { Authorization: `Bearer ${salesA}` } });
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type') || '', /application\/pdf/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    }
    const otherPdf = await fetch(`http://127.0.0.1:${address.port}/api/business/receivables/202/pdf`, { headers: { Authorization: `Bearer ${salesA}` } });
    assert.equal(otherPdf.status, 404);
    await pool.execute("UPDATE employees SET position='员工' WHERE id='U012'");
    assert.equal((await call('/business/receivables', salesA)).status, 403);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
