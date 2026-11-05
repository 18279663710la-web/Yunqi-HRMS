import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceSettingsSchema, validatePunchLocation } from '../src/domains/attendance/attendancePolicy';

test('考勤设置需要同日有效上下班时间及完整打卡地点', () => {
  const base = { startTime: '09:00', inEndTime: '10:00', endTime: '18:00', outEndTime: '19:00', restDates: [], address: '办公楼', floor: '3楼', latitude: 23.1, longitude: 113.3, radius: 100 };
  assert.equal(attendanceSettingsSchema.safeParse(base).success, true);
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, startTime: '18:00', endTime: '09:00' }).success, false);
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, radius: 0 }).success, false);
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, latitude: 100 }).success, false);
});

test('位置校验拒绝缺失、低精度及超出半径的位置', () => {
  const site = { latitude: 23.1, longitude: 113.3, radius: 100 };
  assert.equal(validatePunchLocation(site, { latitude: 23.1, longitude: 113.3, accuracy: 20 }).ok, true);
  assert.equal(validatePunchLocation(site, undefined).ok, false);
  assert.equal(validatePunchLocation(site, { latitude: 23.1, longitude: 113.3, accuracy: 101 }).ok, false);
  assert.equal(validatePunchLocation(site, { latitude: 23.11, longitude: 113.3, accuracy: 10 }).ok, false);
  assert.equal(validatePunchLocation(null, { latitude: 23.1, longitude: 113.3, accuracy: 10 }).ok, false);
});
