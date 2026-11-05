import assert from 'node:assert/strict';
import test from 'node:test';

test('业务接口发现待入职时跳转引导，普通权限错误不触发跳转', async () => {
  const g = globalThis as any; const routes: string[] = [];
  let code = 403;
  g.getCurrentPages = () => [{ route: 'pages/index/index' }];
  g.wx = { getStorageSync: () => 'token', showToast: () => {}, reLaunch: (o: any) => { routes.push(o.url); }, request: (o: any) => o.success({ statusCode: 403, data: { code, message: '无权访问' } }) };
  const { get } = await import('../../miniprogram/utils/request');
  await assert.rejects(get('/company')); assert.deepEqual(routes, []);
  code = 40301; await assert.rejects(get('/company')); assert.deepEqual(routes, ['/pages/onboarding-required/onboarding-required']);
});
