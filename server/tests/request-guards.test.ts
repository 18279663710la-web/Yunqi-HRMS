import assert from 'node:assert/strict';
import test from 'node:test';
import multer from 'multer';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { corsAllowedOrigins } from '../src/shared/middleware/corsOrigin';
import { errorHandler } from '../src/shared/middleware/error';
import {
  assertLoginAllowed,
  clearLoginFailures,
  loginAttemptKey,
  recordLoginFailure,
  resetLoginAttempts,
  withLoginAttempt,
} from '../src/shared/middleware/loginAttempts';
import { DEV_JWT_SECRET, resolveJwtSecret } from '../src/config';
import { HttpError } from '../src/shared/utils/errors';

function listen(app = createApp()): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('测试服务没有端口'));
        return;
      }
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
  });
}

function mockResponse(): { statusCode: number; body: unknown; status: (code: number) => { json: (body: unknown) => void } } {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
  };
  return response;
}

test('跨域星号只允许本机管理后台，显式名单按配置拆分', () => {
  assert.deepEqual(corsAllowedOrigins('*'), ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.deepEqual(corsAllowedOrigins('  '), ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.deepEqual(
    corsAllowedOrigins(' https://admin.example.com , http://localhost:5173 '),
    ['https://admin.example.com', 'http://localhost:5173'],
  );
});

test('生产环境拒绝缺失或开发默认 JWT 密钥，开发环境保留回退值', () => {
  assert.equal(resolveJwtSecret({}), DEV_JWT_SECRET);
  assert.equal(resolveJwtSecret({ JWT_SECRET: '  ' }), DEV_JWT_SECRET);
  assert.equal(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'a-production-secret' }), 'a-production-secret');
  assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: DEV_JWT_SECRET }), /JWT_SECRET/);
});

test('同一登录名和来源连续失败 10 次后拒绝，成功或窗口过期后恢复', () => {
  resetLoginAttempts();
  const key = loginAttemptKey('employee', '127.0.0.1', ' qa-user ');
  const other = loginAttemptKey('admin', '127.0.0.1', 'qa-user');
  const now = 1_000;
  for (let i = 0; i < 9; i += 1) recordLoginFailure(key, now);
  assert.doesNotThrow(() => assertLoginAllowed(key, now));
  assert.throws(() => recordLoginFailure(key, now), (error: unknown) => error instanceof HttpError && error.status === 429);
  assert.throws(() => assertLoginAllowed(key, now), (error: unknown) => error instanceof HttpError && error.status === 429);
  assert.doesNotThrow(() => recordLoginFailure(other, now));
  clearLoginFailures(key);
  assert.doesNotThrow(() => assertLoginAllowed(key, now));
  recordLoginFailure(key, now);
  assert.doesNotThrow(() => assertLoginAllowed(key, now + 10 * 60 * 1000));
});

test('登录成功会清除失败计数，服务器错误不计数', async () => {
  resetLoginAttempts();
  const okKey = loginAttemptKey('employee', '10.0.0.8', 'ok-user');
  for (let i = 0; i < 9; i += 1) recordLoginFailure(okKey);
  assert.equal(await withLoginAttempt('employee', '10.0.0.8', 'ok-user', async () => 'token'), 'token');
  assert.doesNotThrow(() => recordLoginFailure(okKey));

  const dbKey = loginAttemptKey('employee', '10.0.0.8', 'db-user');
  await assert.rejects(
    () => withLoginAttempt('employee', '10.0.0.8', 'db-user', async () => { throw new Error('数据库不可用'); }),
    /数据库不可用/,
  );
  for (let i = 0; i < 9; i += 1) recordLoginFailure(dbKey);
  assert.doesNotThrow(() => assertLoginAllowed(dbKey));
});

test('请求解析和上传限制返回 4xx，重复数据仍返回 409', () => {
  const tooLarge = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 });
  const parsed = Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 });
  const duplicate = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
  const fileTooLarge = new multer.MulterError('LIMIT_FILE_SIZE');
  const cases = [
    { error: parsed, status: 400, message: '请求体不是合法的 JSON' },
    { error: tooLarge, status: 413, message: '请求体过大' },
    { error: fileTooLarge, status: 400, message: '上传文件过大' },
    { error: duplicate, status: 409, message: '数据已存在，请勿重复提交' },
  ];
  for (const item of cases) {
    const response = mockResponse();
    errorHandler(item.error, {} as never, response as never, (() => undefined) as never);
    assert.equal(response.statusCode, item.status);
    assert.deepEqual(response.body, { code: item.status, message: item.message });
  }
});

test('非法 JSON、超限请求体、未知接口和跨域头符合契约，已有接口仍要求登录', async () => {
  const running = await listen();
  try {
    const invalid = await fetch(`${running.base}/api/auth/password-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { code: 400, message: '请求体不是合法的 JSON' });

    const primitive = await fetch(`${running.base}/api/auth/password-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });
    assert.equal(primitive.status, 400);

    const oversized = await fetch(`${running.base}/api/auth/password-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"a":"${'x'.repeat(5 * 1024 * 1024)}"}`,
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { code: 413, message: '请求体过大' });

    const missing = await fetch(`${running.base}/api/__nope__`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { code: 404, message: '接口不存在' });
    const missingWithToken = await fetch(`${running.base}/api/__nope__`, { headers: { authorization: 'Bearer not-a-token' } });
    assert.equal(missingWithToken.status, 404);

    for (const path of ['/api/me', '/api/company', '/api/job-titles', '/api/approvals', '/api/notices', '/api/invoices/meta', '/api/todo-stats']) {
      const response = await fetch(`${running.base}${path}`);
      assert.equal(response.status, 401, path);
    }

    const evil = 'https://evil.example.com';
    const blocked = await fetch(`${running.base}/health`, { headers: { origin: evil } });
    if (!corsAllowedOrigins(config.corsOrigin).includes(evil)) {
      const allow = blocked.headers.get('access-control-allow-origin');
      assert.notEqual(allow, evil);
      assert.notEqual(allow, '*');
    }
    const local = await fetch(`${running.base}/health`, { headers: { origin: 'http://localhost:5173' } });
    if (corsAllowedOrigins(config.corsOrigin).includes('http://localhost:5173')) {
      assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    }
  } finally {
    await running.close();
  }
});

test('员工和管理员登录连续失败 10 次后返回 429，校验失败不计数', async () => {
  resetLoginAttempts();
  const running = await listen();
  try {
    const employeeName = `qa-rate-${Date.now()}`;
    for (let i = 0; i < 11; i += 1) {
      const response = await fetch(`${running.base}/api/auth/password-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ loginName: 'ab', password: 'wrong-password' }),
      });
      assert.equal(response.status, 400);
    }
    const attempts = [];
    for (let i = 0; i < 10; i += 1) {
      const response = await fetch(`${running.base}/api/auth/password-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ loginName: employeeName, password: `wrong-${i}` }),
      });
      attempts.push(response.status);
    }
    assert.deepEqual(attempts.slice(0, 9), Array(9).fill(401));
    assert.equal(attempts[9], 429);

    const adminAttempts = [];
    for (let i = 0; i < 10; i += 1) {
      const response = await fetch(`${running.base}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: employeeName, password: `wrong-${i}` }),
      });
      adminAttempts.push(response.status);
    }
    assert.deepEqual(adminAttempts.slice(0, 9), Array(9).fill(401));
    assert.equal(adminAttempts[9], 429);
  } finally {
    await running.close();
  }
});
