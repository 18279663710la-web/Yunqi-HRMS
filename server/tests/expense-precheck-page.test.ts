import assert from 'node:assert/strict';
import test from 'node:test';

test('手动触发流式预审，提交审批不自动预审，可在修改后再次点击', async () => {
  let definition: any;
  const requests: string[] = [];
  const oldPage = (globalThis as any).Page;
  const oldWx = (globalThis as any).wx;
  const oldPages = (globalThis as any).getCurrentPages;
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).getCurrentPages = () => [1, 2];
  (globalThis as any).wx = {
    getStorageSync: () => 'token', showLoading() {}, hideLoading() {}, showToast() {}, navigateBack() {},
    request(options: any) {
      requests.push(options.url);
      if (options.url.endsWith('/expense-precheck/stream')) {
        return { abort() {}, onChunkReceived(listener: any) {
          queueMicrotask(() => {
            const encode = (v: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(v).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n\n`).buffer;
            listener({ data: encode({ type: 'progress', text: '缺少' }) });
            assert.equal(page.data.precheckProgress, '缺少');
            listener({ data: encode({ type: 'result', status: 'completed', advice: { recommendation: 'reject', reason: '缺少行程单', rule: '需提交行程单', missingAttachments: ['行程单'], attachmentIssues: [] } }) });
            options.success({ statusCode: 200, data: new ArrayBuffer(0) });
          });
        } };
      }
      if (options.url.endsWith('/approvals')) { options.success({ statusCode: 200, data: { code: 0, data: {} } }); return {}; }
      throw new Error('unexpected request');
    },
  };
  let page: any;
  try {
    await import('../../miniprogram/pages/approval-create/approval-create');
    page = { ...definition, data: { ...definition.data, typeKey: 'expense', type: { key: 'expense', name: '报销' }, fields: [{ key: 'reason', label: '费用说明', required: true, type: 'text' }], values: { reason: '出差' }, expenseApproverReady: true, invoiceCheckReady: true, recognized: [{ id: 'i', invoiceNumber: '12345678901234567890', totalAmount: 10 }] }, setData(update: object) { Object.assign(this.data, update); } };
    await page.onAiPrecheck();
    assert.equal(page.data.precheckResult.advice.recommendation, 'reject');
    page.onInput({ currentTarget: { dataset: { key: 'reason' } }, detail: { value: '修改后的内容' } });
    assert.equal(page.data.precheckStale, true);
    await page.onAiPrecheck();
    assert.equal(requests.filter((url) => url.endsWith('/expense-precheck/stream')).length, 2);
    assert.equal(page.data.precheckStale, false);
    await page.onSubmit();
    assert.equal(requests.filter((url) => url.endsWith('/expense-precheck/stream')).length, 2);
    assert.equal(requests.filter((url) => url.endsWith('/approvals')).length, 1);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally { (globalThis as any).Page = oldPage; (globalThis as any).wx = oldWx; (globalThis as any).getCurrentPages = oldPages; }
});
