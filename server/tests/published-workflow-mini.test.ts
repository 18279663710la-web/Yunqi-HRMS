import assert from 'node:assert/strict';
import test from 'node:test';

test('已发布流程使用版本快照及动态字段，不依赖旧审批人预览', async () => {
  let definition: any;
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).wx = { getSystemInfoSync: () => ({ platform: 'devtools' }) };
  await import('../../miniprogram/pages/approval-create/approval-create');
  let oldApproverLookups = 0;
  const type = { key: 'purchase', name: '采购', workflowPublicationVersion: 3, fields: [
    { key: 'item', label: '采购物品', type: 'text', required: true },
    { key: 'project', label: '项目', type: 'picker', required: true, options: ['客户', '内部'] },
  ] };
  const page = { ...definition, data: { ...definition.data, types: [type] },
    setData(value: unknown) { Object.assign(this.data, value); },
    loadTypeApprover: async () => { oldApproverLookups += 1; },
  };
  page.selectType('purchase');
  assert.equal(oldApproverLookups, 0);
  assert.equal(page.data.typeApproverReady, true);
  page.onInput({ currentTarget: { dataset: { key: 'item' } }, detail: { value: '电脑' } });
  page.onPicker({ currentTarget: { dataset: { key: 'project' } }, detail: { value: '0' } });
  const payload = page.buildPayload();
  assert.equal(payload.workflowPublicationVersion, 3);
  assert.deepEqual(payload.workflowValues, { item: '电脑', project: '客户' });
  page.onShow();
  assert.equal(oldApproverLookups, 0);
});
