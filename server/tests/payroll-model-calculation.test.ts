import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateExtendedSalary, fixedSalarySnapshot } from '../src/domains/payroll/payrollModelCalculation';
import { normalizeStoredModel } from '../src/domains/payroll/salaryModelService';

test('工资批次按固定模型所有金额字段求和，扩展字段默认为零', () => {
  const model = normalizeStoredModel({ version: 4, fixedFields: [
    { name: '基本工资', type: 'number' }, { name: '职务津贴', type: 'number' }, { name: '工龄奖', type: 'number' },
  ], extendedFields: [{ name: '出勤天', type: 'number' }, { name: '加班费', type: 'number' }] });
  const snapshot = fixedSalarySnapshot({ values: { 基本工资: 1000.1, 职务津贴: 200.2, 工龄奖: 30, 加班费: 500 } }, model);
  assert.deepEqual(snapshot.fixed, [{ name: '基本工资', value: 1000.1 }, { name: '职务津贴', value: 200.2 }, { name: '工龄奖', value: 30 }]);
  assert.deepEqual(snapshot.extended, [{ name: '出勤天', value: 0, category: 'info' }, { name: '加班费', value: 0, category: 'info' }]);
  assert.equal(snapshot.fixedTotal, 1230.3);
});

test('旧定薪兼容角色镜像，缺失的新字段为零，非法值不能参与计算', () => {
  const model = normalizeStoredModel({ fixedFields: [{ name: '基本工资' }, { name: '工龄奖' }], extendedFields: [] });
  assert.equal(fixedSalarySnapshot({ base: 1200 }, model).fixedTotal, 1200);
  assert.throws(() => fixedSalarySnapshot({ values: { 基本工资: -1 } }, model));
});

test('扩展字段按类别计入，拒绝超额扣款或超出分精度的数字', () => {
  const model = normalizeStoredModel({ fixedFields: [{ name: '基本工资' }], extendedFields: [{ name: '加班费', category: 'income' }, { name: '扣社保', category: 'deduction' }, { name: '出勤天', category: 'info' }] });
  const snapshot = fixedSalarySnapshot({ values: { 基本工资: 100.1 } }, model);
  snapshot.extended[0].value = 10.2; snapshot.extended[1].value = 3.3; snapshot.extended[2].value = 22;
  assert.deepEqual(calculateExtendedSalary(snapshot), { gross: 110.3, deductions: 3.3, net: 107 });
  snapshot.extended[1].value = 111; assert.throws(() => calculateExtendedSalary(snapshot));
  snapshot.extended[1].value = 0.001; assert.throws(() => calculateExtendedSalary(snapshot));
});
