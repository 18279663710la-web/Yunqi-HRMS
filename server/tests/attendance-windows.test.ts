import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceSettingsSchema, getPunchWindow } from '../src/domains/attendance/attendancePolicy';
import { buildDayRecord, summarizeRecords } from '../src/domains/attendance/attendanceService';

const settings = { startTime: '09:00', inEndTime: '10:00', endTime: '18:00', outEndTime: '20:00', restDates: ['2026-10-28'], latitude: 23.1, longitude: 113.3, radius: 100 };

test('打卡时段包含开始与结束分钟，时间段外不可打卡', () => {
  assert.equal(getPunchWindow(settings, '2026-10-27', '08:59'), null);
  assert.equal(getPunchWindow(settings, '2026-10-27', '09:00'), 'in');
  assert.equal(getPunchWindow(settings, '2026-10-27', '10:00'), 'in');
  assert.equal(getPunchWindow(settings, '2026-10-27', '10:01'), null);
  assert.equal(getPunchWindow(settings, '2026-10-27', '18:00'), 'out');
  assert.equal(getPunchWindow(settings, '2026-10-27', '20:00'), 'out');
  assert.equal(getPunchWindow(settings, '2026-10-27', '20:01'), null);
  assert.equal(getPunchWindow(settings, '2026-10-28', '09:30'), null);
});

test('打卡时段不可倒置或重叠', () => {
  assert.equal(attendanceSettingsSchema.safeParse(settings).success, true);
  assert.equal(attendanceSettingsSchema.safeParse({ ...settings, inEndTime: '08:59' }).success, false);
  assert.equal(attendanceSettingsSchema.safeParse({ ...settings, inEndTime: '18:00' }).success, false);
  assert.equal(attendanceSettingsSchema.safeParse({ ...settings, outEndTime: '17:59' }).success, false);
});

test('上班卡晚于 09:30 仍按时间段判定，不产生迟到状态', () => {
  const log = { checkIn: '09:31', checkOut: '18:01', statusOverride: null, note: '', source: 'employee' as const };
  const record = buildDayRecord('2026-10-27', log, { settings });
  assert.equal(record.status, 'normal');
  assert.equal(Object.hasOwn(record, 'isLate'), false);
  assert.equal(summarizeRecords([record]).late, 0);
});

test('考勤状态区分两卡缺失情况和休息日', () => {
  const log = (checkIn: string, checkOut: string) => ({ checkIn, checkOut, statusOverride: null, note: '', source: 'employee' });
  assert.equal(buildDayRecord('2026-10-27', log('09:01', '18:01'), { settings }).status, 'normal');
  assert.equal(buildDayRecord('2026-10-27', log('', '18:01'), { settings }).status, 'missing_in');
  assert.equal(buildDayRecord('2026-10-27', log('09:01', ''), { settings }).status, 'missing_out');
  assert.equal(buildDayRecord('2026-10-27', null, { settings }).status, 'absent');
  assert.equal(buildDayRecord('2026-10-28', null, { settings }).status, 'rest');
  assert.equal(buildDayRecord('2026-10-27', { ...log('', ''), statusOverride: 'leave' }, { settings }).status, 'leave');
  assert.equal(buildDayRecord('2026-10-27', { ...log('', ''), statusOverride: 'rest' }, { settings }).status, 'rest');
  assert.equal(buildDayRecord('2026-10-31', null, { settings }).status, 'absent');
  const s = summarizeRecords([buildDayRecord('2026-10-27', log('', '18:01'), { settings })]);
  assert.equal(s.missingIn, 1);
});

test('当天还未结束下班卡时段时，两卡均未打先提示未打上班卡', () => {
  assert.equal(buildDayRecord('2026-10-27', null, { settings, isToday: true, currentTime: '08:00' }).status, 'missing_in');
  assert.equal(buildDayRecord('2026-10-27', null, { settings, isToday: true, currentTime: '20:00' }).status, 'missing_in');
  assert.equal(buildDayRecord('2026-10-27', null, { settings, isToday: true, currentTime: '20:01' }).status, 'absent');
});
