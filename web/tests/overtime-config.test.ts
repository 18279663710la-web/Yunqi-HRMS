import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOvertimeConfig, defaultOvertimeRules } from '../src/modules/models-formulas/overtime/overtimeConfig';

test('按区间保存连续区间和原有小时金额', () => {
  const rules = [{ minHours: 0, maxHours: 10, hourlyRate: 15 }, { minHours: 10, maxHours: null, hourlyRate: 25 }];
  assert.deepEqual(buildOvertimeConfig('range', rules, null), { calculation: 'range', rules });
  assert.deepEqual(defaultOvertimeRules(), [{ minHours: 0, maxHours: null, hourlyRate: 0 }]);
});

test('按单位仅保存每小时金额，允许零且禁止非法金额', () => {
  assert.deepEqual(buildOvertimeConfig('unit', defaultOvertimeRules(), 0), { calculation: 'unit', hourlyRate: 0 });
  assert.deepEqual(buildOvertimeConfig('unit', defaultOvertimeRules(), 20.5), { calculation: 'unit', hourlyRate: 20.5 });
  for (const rate of [null, -1, 0.001, Number.NaN]) assert.throws(() => buildOvertimeConfig('unit', defaultOvertimeRules(), rate));
});

test('拒绝未填写金额、重叠、断档及没有无上限的区间', () => {
  assert.throws(() => buildOvertimeConfig('range', [{ minHours: 0, maxHours: null, hourlyRate: null }], null));
  assert.throws(() => buildOvertimeConfig('range', [{ minHours: 0, maxHours: 5, hourlyRate: 1 }, { minHours: 6, maxHours: null, hourlyRate: 2 }], null));
  assert.throws(() => buildOvertimeConfig('range', [{ minHours: 0, maxHours: 5, hourlyRate: 1 }], null));
});
