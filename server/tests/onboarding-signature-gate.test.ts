import assert from 'node:assert/strict';
import test from 'node:test';

test('待入职用户能进入签名页，延迟返回的拦截响应不会打断入职流程', async () => {
  const g = globalThis as any; let app: any; let route = 'pages/onboarding-signature/onboarding-signature';
  let mode: 'pending' | 'blocked' = 'pending'; let requests = 0; const navigation: string[] = []; const toasts: string[] = [];
  g.App = (value: any) => { app = value; };
  g.getCurrentPages = () => [{ route }];
  g.wx = {
    getStorageSync: (key: string) => key === 'current_user' ? { position: '员工' } : 'token',
    showToast: (o: any) => toasts.push(o.title),
    reLaunch: (o: any) => navigation.push(o.url),
    request: (o: any) => { requests++; o.success(mode === 'pending' ? { statusCode: 200, data: { code: 0, data: { id: 1 } } } : { statusCode: 403, data: { code: 40301, message: '请先提交入职信息' } }); },
  };
  await import('../../miniprogram/app');
  app.onShow(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0); assert.deepEqual(navigation, []);
  const { get } = await import('../../miniprogram/utils/request'); mode = 'blocked';
  for (route of ['pages/onboarding-required/onboarding-required', 'pages/onboarding/onboarding', 'pages/onboarding-signature/onboarding-signature']) {
    await assert.rejects(get('/company')); assert.deepEqual(navigation, []); assert.deepEqual(toasts, []);
  }
  route = 'pages/attendance/attendance'; await assert.rejects(get('/company'));
  assert.deepEqual(navigation, ['/pages/onboarding-required/onboarding-required']);
  assert.deepEqual(toasts, []);
});
