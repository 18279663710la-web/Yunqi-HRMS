import assert from 'node:assert/strict';
import test from 'node:test';
import { overtimeRuleConfigSchema } from '../src/domains/payroll/overtimePayrollService';

test('加班绩效支持连续区间和单一小时金额', () => {
  const range = { calculation: 'range', rules: [{ minHours: 0, maxHours: 10, hourlyRate: 15 }, { minHours: 10, maxHours: null, hourlyRate: 20.5 }] };
  const unit = { calculation: 'unit', hourlyRate: 20.25 };
  for (const config of [range, unit]) {
    const parsed = overtimeRuleConfigSchema.safeParse(config);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.deepEqual(parsed.data, config);
  }
});

test('拒绝无效小时金额、不连续区间及互相混用的字段', () => {
  for (const config of [
    { calculation: 'unit' }, { calculation: 'unit', hourlyRate: -1 },
    { calculation: 'unit', hourlyRate: 0.001 }, { calculation: 'unit', hourlyRate: 5, rules: [] },
    { calculation: 'range', rules: [{ minHours: 0, maxHours: 10, hourlyRate: 10 }] },
    { calculation: 'range', rules: [{ minHours: 0, maxHours: null, hourlyRate: 10 }], hourlyRate: 10 },
  ]) assert.equal(overtimeRuleConfigSchema.safeParse(config).success, false, JSON.stringify(config));
});
