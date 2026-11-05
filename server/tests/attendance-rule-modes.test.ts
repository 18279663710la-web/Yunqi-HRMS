import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceRuleConfigSchema } from '../src/domains/payroll/attendanceRuleConfig';

test('四种出勤规则方式分别校验对应区间', () => {
  const attendance = [{ minRate: 100, maxRate: 100, adjustment: 200 }, { minRate: 0, maxRate: 100, adjustment: 0 }];
  assert.equal(attendanceRuleConfigSchema.safeParse({ mode: 'rate_attendance', rules: attendance }).success, true);
  assert.equal(attendanceRuleConfigSchema.safeParse({ mode: 'rate_absence', rules: [{ minRate: 0, maxRate: 10, adjustment: 0 }, { minRate: 10, maxRate: 100, adjustment: -100 }] }).success, true);
  for (const mode of ['days_attendance', 'days_absence']) {
    assert.equal(attendanceRuleConfigSchema.safeParse({ mode, rules: [{ minRate: 0, maxRate: 2, adjustment: 0 }, { minRate: 2, maxRate: null, adjustment: -100 }] }).success, true);
  }
});

test('拒绝断档、重叠、错误上限、小数天数和非法金额', () => {
  const invalid = [
    { mode: 'rate_absence', rules: [{ minRate: 0, maxRate: 50, adjustment: 0 }, { minRate: 51, maxRate: 100, adjustment: 0 }] },
    { mode: 'rate_absence', rules: [{ minRate: 0, maxRate: 101, adjustment: 0 }] },
    { mode: 'days_absence', rules: [{ minRate: 0, maxRate: 1.5, adjustment: 0 }, { minRate: 1.5, maxRate: null, adjustment: 0 }] },
    { mode: 'days_attendance', rules: [{ minRate: 0, maxRate: 20, adjustment: 0 }] },
    { mode: 'days_attendance', rules: [{ minRate: 0, maxRate: null, adjustment: 0.001 }] },
  ];
  for (const input of invalid) assert.equal(attendanceRuleConfigSchema.safeParse(input).success, false, JSON.stringify(input));
});

test('按单位可以为四种统计方式保存每单位的正负调整金额', () => {
  for (const mode of ['rate_attendance', 'rate_absence', 'days_attendance', 'days_absence']) {
    for (const unitAdjustment of [-10.25, 0, 12.5]) {
      const value = { mode, calculation: 'unit', unitAdjustment };
      const parsed = attendanceRuleConfigSchema.safeParse(value);
      assert.equal(parsed.success, true, JSON.stringify(value));
      if (parsed.success) assert.deepEqual(parsed.data, value);
    }
  }
});

test('按单位必须填写有效的金额，不能同时提交区间', () => {
  for (const value of [
    { mode: 'rate_absence', calculation: 'unit' },
    { mode: 'rate_absence', calculation: 'unit', unitAdjustment: 0.001 },
    { mode: 'rate_absence', calculation: 'unit', unitAdjustment: -10000000000 },
    { mode: 'rate_absence', calculation: 'unit', unitAdjustment: 5, rules: [] },
  ]) assert.equal(attendanceRuleConfigSchema.safeParse(value).success, false);
});
