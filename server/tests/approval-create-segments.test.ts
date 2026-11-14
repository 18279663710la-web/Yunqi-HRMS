import assert from 'node:assert/strict';
import test from 'node:test';

test('申请页按设计顺序插入发票附件和补充材料，未发布报销仍排在末尾', async () => {
  let definition: any;
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).wx = { getSystemInfoSync: () => ({ platform: 'devtools' }) };
  await import('../../miniprogram/pages/approval-create/approval-create');
  const designed = { key: 'expense', name: '报销', fields: [
    { key: 'amount', label: '报销金额（元）', type: 'money', required: true },
    { key: 'invoiceFiles', label: '发票附件', type: 'attachment', required: true },
    { key: 'reason', label: '费用说明', type: 'textarea', required: true },
    { key: 'supplementFiles', label: '补充材料', type: 'attachment', required: false },
  ] };
  const legacy = { key: 'expense', name: '报销', fields: [
    { key: 'amount', label: '报销金额（元）', type: 'money', required: true },
    { key: 'reason', label: '费用说明', type: 'textarea', required: true },
  ] };
  const page = {
    ...definition,
    data: { ...definition.data, types: [designed] },
    setData(data: Record<string, unknown>) { Object.assign(this.data, data); },
    scheduleApprovers() {},
  };
  page.selectType('expense');
  assert.deepEqual(page.data.segments.map((segment: { kind: string }) => segment.kind), ['fields', 'invoice', 'fields', 'materials']);
  assert.deepEqual(page.data.segments[0].fields.map((field: { key: string }) => field.key), ['amount']);
  assert.deepEqual(page.data.segments[2].fields.map((field: { key: string }) => field.key), ['reason']);
  assert.deepEqual(page.data.fields.map((field: { key: string }) => field.key), ['amount', 'reason']);
  const payload = page.buildPayload();
  assert.equal(payload.form.some((item: { label: string }) => item.label === '发票附件' || item.label === '补充材料'), false);

  page.data.types = [legacy];
  page.selectType('expense');
  assert.deepEqual(page.data.segments.map((segment: { kind: string }) => segment.kind), ['fields', 'invoice', 'materials']);
  assert.deepEqual(page.data.segments[0].fields.map((field: { key: string }) => field.key), ['amount', 'reason']);
});
