import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLeaveDays as serverDays } from '../src/shared/utils/leaveDuration';
import { calculateLeaveDays as miniDays } from '../../miniprogram/utils/leave-duration';

for (const [name, calculate] of [['服务端', serverDays], ['小程序', miniDays]] as const) {
  test(`${name}不足一天至少记一天，超过一天按 12 小时进位`, () => {
    assert.equal(calculate('2026-10-28', '00:00', '2026-10-28', '00:01'), 1);
    assert.equal(calculate('2026-10-28', '00:00', '2026-10-28', '11:59'), 1);
    assert.equal(calculate('2026-10-28', '00:00', '2026-10-28', '12:00'), 1);
    assert.equal(calculate('2026-10-28', '09:00', '2026-10-29', '09:00'), 1);
    assert.equal(calculate('2026-10-28', '00:00', '2026-10-29', '11:59'), 1);
    assert.equal(calculate('2026-10-28', '00:00', '2026-10-29', '12:00'), 2);
    assert.equal(calculate('2028-02-28', '08:00', '2028-03-01', '08:00'), 2);
  });
  test(`${name}拒绝缺失、无效或结束不晚于开始的时间`, () => {
    assert.equal(calculate('2026-02-30', '09:00', '2026-03-01', '09:00'), null);
    assert.equal(calculate('2026-10-28', '24:00', '2026-10-29', '09:00'), null);
    assert.equal(calculate('2026-10-28', '09:00', '2026-10-28', '09:00'), null);
    assert.equal(calculate('2026-10-28', '10:00', '2026-10-28', '09:00'), null);
    assert.equal(calculate('', '09:00', '2026-10-28', '09:00'), null);
  });
}
