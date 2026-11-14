import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttendanceRecord } from '../src/shared/types/models';
import { countPayrollDays, isPayrollEmployed, payrollEmployment } from '../src/domains/attendance/payrollAttendanceSource';

function record(partial: Partial<AttendanceRecord> & Pick<AttendanceRecord, 'status'>): AttendanceRecord {
  return {
    date: '2020-06-01',
    day: 1,
    month: 6,
    weekdayText: '一',
    checkIn: '',
    checkOut: '',
    statusText: '',
    duration: '—',
    ...partial,
  };
}

test('入职前、离职后和复职空窗不是在职日，两端日期仍在职', () => {
  const employment = payrollEmployment('2020-04-01', [
    { status: 'departed', lastDate: '2020-06-24', reinstatementDate: '2020-07-01' },
    { status: 'cancelled', lastDate: '2020-05-10', reinstatementDate: '2020-05-20' },
    { status: 'cancelled', lastDate: '2020-04-05', reinstatementDate: null },
    { status: 'applied', lastDate: '2020-06-01', reinstatementDate: null },
  ]);
  assert.equal(employment.openDeparture, '2020-06-24');
  assert.equal(employment.gaps.length, 1);
  assert.equal(isPayrollEmployed('2020-03-31', employment), false);
  assert.equal(isPayrollEmployed('2020-04-01', employment), true);
  assert.equal(isPayrollEmployed('2020-04-06', employment), true);
  assert.equal(isPayrollEmployed('2020-06-24', employment), true);
  assert.equal(isPayrollEmployed('2020-06-25', employment), false);
  assert.equal(isPayrollEmployed('2020-05-10', employment), true);
  assert.equal(isPayrollEmployed('2020-05-11', employment), false);
  assert.equal(isPayrollEmployed('2020-05-19', employment), false);
  assert.equal(isPayrollEmployed('2020-05-20', employment), true);
});

test('多条已离职记录取最晚离职日', () => {
  const employment = payrollEmployment('2020-01-01', [
    { status: 'departed', lastDate: '2020-03-01', reinstatementDate: null },
    { status: 'departed', lastDate: '2020-06-01', reinstatementDate: null },
  ]);
  assert.equal(employment.openDeparture, '2020-06-01');
  assert.equal(isPayrollEmployed('2020-03-02', employment), true);
  assert.equal(isPayrollEmployed('2020-06-02', employment), false);
});

test('休息不计应出勤，出差计出勤，请假只计应出勤，未完成打卡日记为需要打卡', () => {
  const counted = countPayrollDays([
    record({ status: 'rest' }),
    record({ status: 'travel', checkIn: '09:00', checkOut: '18:00' }),
    record({ status: 'leave', checkIn: '09:00', checkOut: '18:00' }),
    record({ status: 'normal', checkIn: '09:00', checkOut: '18:00' }),
    record({ status: 'absent' }),
    record({ status: 'missing_out', checkIn: '09:00' }),
  ]);
  assert.equal(counted.workdays, 5);
  assert.equal(counted.presentDays, 2);
  assert.equal(counted.requiresPunch, true);
});

test('全是休息日，或只有出差和请假时，不要求打卡', () => {
  assert.deepEqual(countPayrollDays([record({ status: 'rest' }), record({ status: 'rest' })]), {
    presentDays: 0,
    workdays: 0,
    requiresPunch: false,
  });
  const covered = countPayrollDays([
    record({ status: 'travel' }),
    record({ status: 'leave', checkIn: '09:00', checkOut: '18:00' }),
  ]);
  assert.equal(covered.presentDays, 1);
  assert.equal(covered.workdays, 2);
  assert.equal(covered.requiresPunch, false);
});
