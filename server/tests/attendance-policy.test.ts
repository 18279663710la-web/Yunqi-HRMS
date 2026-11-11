import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceSettingsSchema, validatePunchLocation } from '../src/domains/attendance/attendancePolicy';

test('考勤设置要求打卡时段顺序有效且两段不重合', () => {
  const base = { startTime: '09:00', inEndTime: '10:00', endTime: '18:00', outEndTime: '19:00', restDates: [], latitude: 23.1, longitude: 113.3, radius: 100 };
  assert.equal(attendanceSettingsSchema.safeParse(base).success, true);
  // 两个时间段可自由设置，只要不重合且上班卡整体早于下班卡。
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, startTime: '05:00', inEndTime: '08:00', endTime: '09:00', outEndTime: '11:00' }).success, true);
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, startTime: '10:30', inEndTime: '10:00' }).success, false);
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, endTime: '19:30', outEndTime: '19:00' }).success, false);
  // 上班卡时间段与下班卡时间段重合或不晚于下班卡时间段时拒绝。
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, inEndTime: '18:00' }).success, false);
  assert.equal(attendanceSettingsSchema.safeParse({ ...base, inEndTime: '18:30' }).success, false);
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
