import assert from 'node:assert/strict';
import test from 'node:test';

test('AI 失败后可在审批详情触发重试并刷新', async () => {
  let definition: any;
  const requests: string[] = [];
  const originalPage = (globalThis as any).Page;
  const originalWx = (globalThis as any).wx;
  (globalThis as any).Page = (value: unknown) => { definition = value; };
  (globalThis as any).wx = { getSystemInfoSync: () => ({ platform: 'devtools' }), getStorageSync: () => 'test-token', showToast() {},
    request(options: any) { requests.push(options.url); options.success({ statusCode: 200, data: { code: 0, data: { ok: true } } }); return {}; } };
  try {
    await import('../../miniprogram/pages/approval-detail/approval-detail');
    let refreshes = 0;
    const page = { ...definition, data: { ...definition.data, id: 'FA_TEST', retryingAi: false }, setData(value: unknown) { Object.assign(this.data, value); }, load: async () => { refreshes += 1; } };
    await page.retryAi();
    assert.equal(requests.filter(url => url.endsWith('/approvals/FA_TEST/retry-ai')).length, 1);
    assert.equal(refreshes, 1);
    assert.equal(page.data.retryingAi, false);
  } finally { (globalThis as any).Page = originalPage; (globalThis as any).wx = originalWx; }
});
