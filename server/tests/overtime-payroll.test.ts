import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateOvertimePay, overtimeRulesSchema } from '../src/domains/payroll/overtimePayrollService';

test('按月累计加班时长匹配单一区间，以该区间小时金额计算并四舍五入到分', () => {
  const rules = [{ minHours: 0, maxHours: 10, hourlyRate: 12.5 }, { minHours: 10, maxHours: null, hourlyRate: 20 }];
  assert.equal(overtimeRulesSchema.safeParse(rules).success, true);
  assert.equal(calculateOvertimePay(9 * 3600 + 1800, rules).amount, 118.75);
  assert.equal(calculateOvertimePay(10 * 3600, rules).amount, 200);
  assert.equal(calculateOvertimePay(61, [{ minHours: 0, maxHours: null, hourlyRate: 10 }]).amount, 0.17);
});

test('加班区间必须从零连续覆盖至无上限', () => {
  assert.equal(overtimeRulesSchema.safeParse([{ minHours: 1, maxHours: null, hourlyRate: 1 }]).success, false);
  assert.equal(overtimeRulesSchema.safeParse([{ minHours: 0, maxHours: 10, hourlyRate: 1 }, { minHours: 11, maxHours: null, hourlyRate: 2 }]).success, false);
  assert.equal(overtimeRulesSchema.safeParse([{ minHours: 0, maxHours: 10, hourlyRate: 1 }]).success, false);
});
