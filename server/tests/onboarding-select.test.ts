import assert from 'node:assert/strict';
import test from 'node:test';

test('小程序单选字段和表格单选子字段按选项索引回填', async () => {
  const g = globalThis as any;
  let page: any;
  g.Page = (definition: unknown) => { page = definition; };
  g.wx = { showToast: () => {}, reLaunch: () => {} };
  await import('../../miniprogram/pages/onboarding/onboarding');
  const instance = { ...page, data: structuredClone(page.data), setData(update: unknown) { Object.assign(this.data, update); } };
  instance.data.onboarding = { template: [
    { name: '性别', type: 'select', required: true, options: ['男', '女'], value: '', valueIndex: 0 },
    { name: '教育经历', type: 'table', required: false, value: '', rows: [{ id: 'r1', values: {}, indexes: {} }], children: [{ name: '性质', type: 'select', required: true, options: ['全职', '实习'], value: '' }] },
  ] };

  instance.selectOnboarding({ currentTarget: { dataset: { index: 0 } }, detail: { value: '1' } });
  assert.equal(instance.data.onboarding.template[0].value, '女');
  assert.equal(instance.data.onboarding.template[0].valueIndex, 1);

  instance.selectOnboardingCell({ currentTarget: { dataset: { index: 1, row: 0, child: 0 } }, detail: { value: '0' } });
  assert.equal(instance.data.onboarding.template[1].rows[0].values.性质, '全职');
  assert.equal(instance.data.onboarding.template[1].rows[0].indexes.性质, 0);

  instance.selectOnboarding({ currentTarget: { dataset: { index: 0 } }, detail: { value: '9' } });
  assert.equal(instance.data.onboarding.template[0].value, '女');
});
