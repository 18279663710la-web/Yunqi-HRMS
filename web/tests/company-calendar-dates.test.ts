import assert from 'node:assert/strict';
import test from 'node:test';
import dayjs from 'dayjs';
import { expandDateRanges, mergeDatesToRanges } from '../src/modules/models-formulas/company-calendar/calendarDates';

test('例外日期范围支持起止同日、跨月和重叠去重', () => {
  assert.deepEqual(
    expandDateRanges([[dayjs('2026-10-01'), dayjs('2026-10-01')]]),
    ['2026-10-01']
  );
  assert.deepEqual(
    expandDateRanges([[dayjs('2026-10-31'), dayjs('2026-11-02')]]),
    ['2026-10-31', '2026-11-01', '2026-11-02']
  );
  assert.deepEqual(
    expandDateRanges([
      [dayjs('2026-10-01'), dayjs('2026-10-02')],
      [dayjs('2026-10-02'), dayjs('2026-10-03')],
    ]),
    ['2026-10-01', '2026-10-02', '2026-10-03']
  );
  assert.deepEqual(
    expandDateRanges([[dayjs('2026-10-03'), dayjs('2026-10-01')]]),
    ['2026-10-01', '2026-10-02', '2026-10-03']
  );
});

test('连续例外日期在编辑时合并为起止范围', () => {
  const ranges = mergeDatesToRanges(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-05']);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0][0].format('YYYY-MM-DD'), '2026-10-01');
  assert.equal(ranges[0][1].format('YYYY-MM-DD'), '2026-10-03');
  assert.equal(ranges[1][0].format('YYYY-MM-DD'), '2026-10-05');
  assert.equal(ranges[1][1].format('YYYY-MM-DD'), '2026-10-05');
  const crossMonth = mergeDatesToRanges(['2026-10-31', '2026-11-01']);
  assert.equal(crossMonth.length, 1);
  assert.equal(crossMonth[0][1].format('YYYY-MM-DD'), '2026-11-01');
});
