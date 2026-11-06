import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAttendanceRule } from '../src/domains/payroll/attendanceRuleCalculation';

test('出勤率规则按实际出勤及应出勤计算并匹配全勤和边界', () => {
  const config = { mode: 'rate_attendance', calculation: 'range', rules: [{ minRate: 100, maxRate: 100, adjustment: 100 }, { minRate: 80, maxRate: 100, adjustment: 20 }, { minRate: 0, maxRate: 80, adjustment: -30 }] } as const;
  assert.equal(calculateAttendanceRule(config, 20, 20).amount, 100);
  assert.equal(calculateAttendanceRule(config, 16, 20).amount, 20);
  assert.equal(calculateAttendanceRule(config, 15, 20).amount, -30);
  assert.throws(() => calculateAttendanceRule(config, 0, 0), /应出勤/);
});

test('缺勤天数和缺勤比例按单位调整，负数金额保留两位小数', () => {
  assert.equal(calculateAttendanceRule({ mode: 'days_absence', calculation: 'unit', unitAdjustment: -5 }, 18, 20).amount, -10);
  assert.equal(calculateAttendanceRule({ mode: 'rate_absence', calculation: 'unit', unitAdjustment: -0.03 }, 19, 20).amount, -0.15);
  assert.equal(calculateAttendanceRule({ mode: 'days_attendance', calculation: 'range', rules: [{ minRate: 0, maxRate: 10, adjustment: -10 }, { minRate: 10, maxRate: null, adjustment: 50 }] }, 10, 20).amount, 50);
});
