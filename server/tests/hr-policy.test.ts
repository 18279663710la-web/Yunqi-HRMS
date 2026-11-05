import assert from 'node:assert/strict';
import test from 'node:test';
import { onboardingFieldsSchema, payrollRecordSchema } from '../src/admin/hr/hrPolicy';

test('入职表字段名称不能为空或重复', () => {
  assert.equal(onboardingFieldsSchema.safeParse(['姓名', '电话']).success, true);
  assert.equal(onboardingFieldsSchema.safeParse(['姓名', ' 姓名 ']).success, false);
  assert.equal(onboardingFieldsSchema.safeParse(['']).success, false);
});

test('工资发放记录必须包含有效月份和非负金额', () => {
  const record = { employeeId: 'U001', month: '2026-10', amount: 5000, note: '' };
  assert.equal(payrollRecordSchema.safeParse(record).success, true);
  assert.equal(payrollRecordSchema.safeParse({ ...record, month: '2026-13' }).success, false);
  assert.equal(payrollRecordSchema.safeParse({ ...record, amount: -1 }).success, false);
});
