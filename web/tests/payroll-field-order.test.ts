import assert from 'node:assert/strict';
import test from 'node:test';
import { payrollFieldNames } from '../src/modules/hr/payroll/payrollFieldOrder';
import type { PayrollModelSnapshot, SalaryComponentModel } from '../src/modules/hr/api';

const model: SalaryComponentModel = {
  version: 1,
  fixedFields: [
    { name: '姓名', type: 'text', required: true, role: 'name' },
    { name: '员工号', type: 'text', required: true, role: 'employeeNo' },
    { name: '职务', type: 'text', required: true, role: 'position' },
    { name: '基本工资', type: 'number', required: true },
  ],
  extendedFields: [{ name: '业务提成', type: 'number', required: false }, { name: '扣社保', type: 'number', required: false }],
  fieldOrder: ['姓名', '基本工资', '扣社保', '员工号', '业务提成', '职务'],
};
const snapshot = (names: string[]): PayrollModelSnapshot => ({ version: 1, revision: 0, fixedTotal: 0, fixed: [], extended: names.map(name => ({ name, value: 0, category: 'info' })) });

test('工资列表按模型保存顺序显示身份、固定及扩展字段', () => {
  assert.deepEqual(payrollFieldNames(model, [snapshot(['业务提成', '扣社保'])]), model.fieldOrder);
});

test('历史快照独有字段追加且去重，模型没有排序时使用原有顺序', () => {
  assert.deepEqual(payrollFieldNames({ ...model, fieldOrder: undefined }, [snapshot(['旧补贴', '扣社保']), snapshot(['另一旧项', '旧补贴'])]), ['姓名', '员工号', '职务', '基本工资', '业务提成', '扣社保', '旧补贴', '另一旧项']);
  assert.deepEqual(payrollFieldNames(undefined, [snapshot(['旧补贴'])]), ['姓名', '员工号', '职务', '旧补贴']);
});
