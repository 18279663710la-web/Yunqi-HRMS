import assert from 'node:assert/strict';
import test from 'node:test';

test('小程序待入职引导及独立页面：失败不放行，提交成功后进入工作台', async () => {
  const g = globalThis as any;
  let page: any; const navigations: string[] = []; let pending: any = { id: 1, declaration: '声明', template: [{ name: '姓名', type: 'text', required: true }] };
  let failPending = false; let failSubmit = false; let submitCount = 0; const toasts: string[] = [];
  g.Page = (definition: unknown) => { page = definition; };
  g.wx = {
    getStorageSync: (key: string) => key === 'access_token' ? 'token' : '',
    request: (options: any) => {
      if (options.url.endsWith('/onboarding-form/pending')) {
        if (failPending) options.fail({ errMsg: 'network' });
        else options.success({ statusCode: 200, data: { code: 0, data: pending } });
      } else if (options.url.endsWith('/onboarding-form/submit')) {
        submitCount++;
        options.success(failSubmit ? { statusCode: 400, data: { message: '填写有误' } } : { statusCode: 200, data: { code: 0, data: {} } });
      }
    },
    reLaunch: (options: any) => navigations.push(options.url),
    showToast: (options: any) => { toasts.push(options.title); },
  };
  g.getCurrentPages = () => [];
  const { getEntryDestination } = await import('../../miniprogram/services/onboarding/onboardingGate');
  assert.equal(await getEntryDestination(false), '/pages/onboarding-required/onboarding-required');
  failPending = true; await assert.rejects(getEntryDestination(false)); failPending = false;
  await import('../../miniprogram/pages/onboarding/onboarding');
  const instance = { ...page, data: structuredClone(page.data), setData(update: unknown) { Object.assign(this.data, update); } };
  failPending = true; await instance.loadOnboarding(); assert.equal(instance.data.loadError, true); assert.deepEqual(navigations, []);
  failPending = false; await instance.loadOnboarding(); assert.equal(instance.data.onboarding.template[0].value, '');
  await instance.submitOnboarding(); assert.deepEqual(navigations, []);
  instance.data.onboarding.template[0].value = '测试';
  await instance.submitOnboarding(); assert.equal(submitCount, 0); assert.match(toasts[toasts.length - 1], /同意声明/);
  instance.toggleDeclaration({ detail: { value: ['accepted'] } }); assert.equal(instance.data.declarationAccepted, true);
  instance.toggleDeclaration({ detail: { value: [] } }); assert.equal(instance.data.declarationAccepted, false);
  instance.toggleDeclaration({ detail: { value: ['accepted'] } });
  await instance.submitOnboarding(); assert.equal(submitCount, 0); assert.match(toasts[toasts.length - 1], /签名/);
  instance.data.onboardingSignature = 'data:image/png;base64,iVBORw0KGgo=';
  failSubmit = true; await instance.submitOnboarding(); assert.deepEqual(navigations, []);
  failSubmit = false; await instance.submitOnboarding(); assert.deepEqual(navigations, ['/pages/index/index']);
  pending = null; assert.equal(await getEntryDestination(false), '/pages/index/index');
});
