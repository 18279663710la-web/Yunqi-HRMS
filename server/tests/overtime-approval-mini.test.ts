import assert from 'node:assert/strict';
import test from 'node:test';

test('加班申请隐藏补偿方式，填写其他必填项后可提交；切换其他类型不受影响', async () => {
  let definition: any;
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).wx = { getSystemInfoSync: () => ({ platform: 'devtools' }) };
  await import('../../miniprogram/pages/approval-create/approval-create');
  const overtime = { key: 'overtime', name: '加班', fields: [
    { key: 'date', label: '加班日期', type: 'date', required: true },
    { key: 'startTime', label: '开始时间', type: 'time', required: true },
    { key: 'compensation', label: '补偿方式', type: 'picker', required: true, options: ['调休', '加班费'] },
    { key: 'reason', label: '加班事由', type: 'textarea', required: true },
  ] };
  const purchase = { key: 'purchase', name: '采购', fields: [{ key: 'item', label: '物品', type: 'text', required: true }] };
  const page = {
    ...definition,
    data: { ...definition.data, types: [overtime, purchase] },
    setData(data: unknown) { Object.assign(this.data, data); },
    loadTypeApprover: async () => {},
  };
  page.selectType('overtime');
  assert.deepEqual(page.data.fields.map((field: { key: string }) => field.key), ['date', 'startTime', 'reason']);
  page.onPicker({ currentTarget: { dataset: { key: 'startTime' } }, detail: { value: '19:00' } });
  page.onInput({ currentTarget: { dataset: { key: 'reason' } }, detail: { value: '项目工作' } });
  assert.equal(page.data.canSubmit, true);
  const payload = page.buildPayload();
  assert.equal(payload.form.some((item: { label: string }) => item.label === '补偿方式'), false);
  assert.match(payload.summary, /补偿方式：加班费$/);
  page.selectType('purchase');
  assert.deepEqual(page.data.fields.map((field: { key: string }) => field.key), ['item']);
});
