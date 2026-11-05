import assert from 'node:assert/strict';
import test from 'node:test';

test('小程序按审批类型加载对应审批人，切换类型后忽略旧请求且未配置时不能提交', async () => {
  let definition: any;
  const pending: Record<string, any> = {};
  const toastMessages: string[] = [];
  const oldPage = (globalThis as any).Page;
  const oldWx = (globalThis as any).wx;
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).wx = {
    getStorageSync: () => 'token',
    showToast(options: any) { toastMessages.push(options.title); },
    request(options: any) { const key = options.url.split('/').pop(); pending[key] = options; },
  };
  try {
    await import('../../miniprogram/pages/approval-create/approval-create');
    const page: any = { ...definition, data: { ...definition.data, typeKey: 'overtime', type: { key: 'overtime' }, fields: [], values: {}, typeApproverReady: false }, setData(update: object) { Object.assign(this.data, update); } };
    await page.onSubmit();
    assert.ok(toastMessages.some((message) => message.includes('审批人不可用')));
    assert.equal(Object.keys(pending).length, 0, '未配置审批人不提交');
    const oldRequest = page.loadTypeApprover('overtime');
    page.data.typeKey = 'travel';
    page.approverGeneration += 1;
    const newRequest = page.loadTypeApprover('travel');
    pending.travel.success({ statusCode: 200, data: { code: 0, data: { id: 'U005', name: '出差审批人', role: '出差审批人' } } });
    await newRequest;
    pending.overtime.success({ statusCode: 200, data: { code: 0, data: { id: 'U011', name: '加班审批人', role: '加班审批人' } } });
    await oldRequest;
    assert.equal(page.data.leader.name, '出差审批人');
    assert.equal(page.data.typeApproverReady, true);
  } finally { (globalThis as any).Page = oldPage; (globalThis as any).wx = oldWx; }
});
