import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSalaryModelGroups, SALARY_IDENTITY_FIELDS } from '../src/modules/models-formulas/salary/salaryModel';

test('固定、扩展和身份字段的显示设置能够保留', () => {
  const identities = SALARY_IDENTITY_FIELDS.map((field, index) => index === 0 ? { ...field, displaySetting: 'display' as const } : field);
  const groups = buildSalaryModelGroups([{ name: '工资', displaySetting: 'output' }], [{ name: '出勤天', displaySetting: 'display' }], identities);
  assert.equal(groups.fixedFields[0].displaySetting, 'display');
  assert.equal(groups.fixedFields[3].displaySetting, 'output');
  assert.equal(groups.extendedFields[0].displaySetting, 'display');
  const cleared = buildSalaryModelGroups([{ name: '工资', displaySetting: 'none' }], []);
  assert.equal(cleared.fixedFields[3].displaySetting ?? 'none', 'none');
});
