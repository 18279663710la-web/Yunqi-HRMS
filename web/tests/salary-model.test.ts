import assert from 'node:assert/strict';
import test from 'node:test';
import { SALARY_IDENTITY_FIELDS, buildSalaryModelGroups } from '../src/utils/salaryModel';

test('固定模型注入姓名、员工号及职务并允许没有金额字段', () => {
  assert.deepEqual(SALARY_IDENTITY_FIELDS.map(field => field.name), ['姓名', '员工号', '职务']);
  assert.deepEqual(buildSalaryModelGroups([], []), { fixedFields: SALARY_IDENTITY_FIELDS, extendedFields: [] });
  assert.deepEqual(buildSalaryModelGroups([{ name: '基础薪资', required: true }], []), {
    fixedFields: [...SALARY_IDENTITY_FIELDS, { name: '基础薪资', type: 'number', required: true }],
    extendedFields: [],
  });
});

test('字段名称去空格、强制数字类型并保留角色', () => {
  assert.deepEqual(buildSalaryModelGroups([{ name: ' 基础薪资 ', required: false, role: 'base' }], [{ name: ' 交通补贴 ' }]), {
    fixedFields: [...SALARY_IDENTITY_FIELDS, { name: '基础薪资', type: 'number', required: false, role: 'base' }],
    extendedFields: [{ name: '交通补贴', type: 'number', required: true, category: 'info' }],
  });
});

test('扩展字段保留收入或扣款类别', () => {
  assert.deepEqual(buildSalaryModelGroups([], [{ name: '加班费', category: 'income' }, { name: '扣社保', category: 'deduction' }]).extendedFields.map(field => field.category), ['income', 'deduction']);
});

test('姓名和员工号不会作为金额字段重复添加，也不能放入扩展字段', () => {
  assert.deepEqual(buildSalaryModelGroups([{ name: '姓名' }, { name: '基础薪资' }], []).fixedFields, [
    ...SALARY_IDENTITY_FIELDS,
    { name: '基础薪资', type: 'number', required: true },
  ]);
  assert.throws(() => buildSalaryModelGroups([], [{ name: '员工号' }]), /姓名、员工号和职务是固定字段/);
  assert.throws(() => buildSalaryModelGroups([], [{ name: '职务' }]), /姓名、员工号和职务是固定字段/);
});

test('跨组字段不能重名', () => {
  assert.throws(() => buildSalaryModelGroups([{ name: '补贴' }], [{ name: ' 补贴 ' }]), /字段名称不能重复/);
});

test('总数包含三个身份字段且不能超过 51', () => {
  const fields = Array.from({ length: 48 }, (_, index) => ({ name: `字段${index + 1}` }));
  assert.doesNotThrow(() => buildSalaryModelGroups(fields, []));
  assert.throws(() => buildSalaryModelGroups([...fields, { name: '字段49' }], []), /最多配置 51 个字段/);
  assert.throws(() => buildSalaryModelGroups(fields, [{ name: '扩展字段' }]), /最多配置 51 个字段/);
});
