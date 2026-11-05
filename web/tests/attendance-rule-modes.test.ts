import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRanges, defaultModeRules, validateRanges } from '../src/modules/models-formulas/attendance/attendanceRuleModes';

test('天数规则以非负整数连续覆盖到无上限', () => {
  assert.deepEqual(defaultModeRules('days_attendance'), [{ minRate: 0, maxRate: null, adjustment: 0 }]);
  const rules = buildRanges('days_absence', [{ minRate: 0, maxRate: 3, adjustment: 10 }, { minRate: 99, maxRate: null, adjustment: -20 }]);
  assert.deepEqual(rules, [{ minRate: 0, maxRate: 3, adjustment: 10 }, { minRate: 3, maxRate: null, adjustment: -20 }]);
  assert.equal(validateRanges('days_absence', rules), undefined);
  assert.ok(validateRanges('days_absence', [{ minRate: 0, maxRate: 2.5, adjustment: 0 }, { minRate: 2.5, maxRate: null, adjustment: 0 }]));
});

test('缺勤比例规则覆盖 0 到 100，拒绝无效金额与断档', () => {
  assert.equal(validateRanges('rate_absence', [{ minRate: 0, maxRate: 20, adjustment: 0 }, { minRate: 20, maxRate: 100, adjustment: -10 }]), undefined);
  assert.ok(validateRanges('rate_absence', [{ minRate: 0, maxRate: 20, adjustment: 0 }, { minRate: 21, maxRate: 100, adjustment: 0 }]));
  assert.ok(validateRanges('rate_absence', [{ minRate: 0, maxRate: 100, adjustment: 0.001 }]));
});
