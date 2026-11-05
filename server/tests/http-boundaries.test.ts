import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { config } from '../src/config';

test('公共健康检查、未知路由及双端未认证请求保持原有响应', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { ok: boolean }).ok, true);
    for (const path of ['/api/admin/employees', '/api/attendance/today']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401);
      assert.equal((await response.json() as { code: number }).code, 401);
    }
    const adminToken = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: '1' });
    const employeeToken = jwt.sign({ typ: 'access' }, config.jwt.secret, { subject: 'U001' });
    for (const [path, token] of [['/api/attendance/today', adminToken], ['/api/admin/employees', employeeToken]]) {
      const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 401);
    }
    const missing = await fetch(`${base}/not-a-route`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { code: 404, message: '接口不存在' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
