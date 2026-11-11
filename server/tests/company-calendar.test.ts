import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCalendarRestDate,
  resolveCalendarRestDates,
  resolveConfiguredRestDates,
  type CompanyCalendarRule,
} from '../src/domains/attendance/companyCalendar';

function rule(overrides: Partial<CompanyCalendarRule>): CompanyCalendarRule {
  return {
    id: 1,
    name: '测试日历',
    mode: 'none',
    weeklyRestDays: [],
    cycleWeeks: null,
    cycleRestDays: [],
    anchorDate: null,
    restDates: [],
    workDates: [],
    usageCount: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

test('每周固定休息日支持例外休息和例外上班覆盖', () => {
  const calendar = rule({
    mode: 'weekly',
    weeklyRestDays: [6, 0],
    restDates: ['2026-08-05'],
    workDates: ['2026-08-08'],
  });
  assert.equal(isCalendarRestDate(calendar, '2026-08-08'), false);
  assert.equal(isCalendarRestDate(calendar, '2026-08-05'), true);
  assert.equal(isCalendarRestDate(calendar, '2026-08-09'), true);
  assert.deepEqual(
    Array.from(resolveCalendarRestDates(calendar, '2026-08-03', '2026-08-09')).sort(),
    ['2026-08-05', '2026-08-09']
  );
});

test('按周轮换支持大小周并在跨周时循环', () => {
  const calendar = rule({
    mode: 'cycle',
    cycleWeeks: 2,
    cycleRestDays: [[6, 0], [0]],
    anchorDate: '2026-08-03',
  });
  assert.deepEqual(
    Array.from(resolveCalendarRestDates(calendar, '2026-08-03', '2026-08-09')).sort(),
    ['2026-08-08', '2026-08-09']
  );
  assert.deepEqual(
    Array.from(resolveCalendarRestDates(calendar, '2026-08-10', '2026-08-16')).sort(),
    ['2026-08-16']
  );
  assert.deepEqual(
    Array.from(resolveCalendarRestDates(calendar, '2026-08-17', '2026-08-23')).sort(),
    ['2026-08-22', '2026-08-23']
  );
});

test('不固定规则只使用例外日期，无日历时回退旧休息日期', () => {
  const calendar = rule({ restDates: ['2026-08-05'], workDates: [] });
  assert.deepEqual(Array.from(resolveCalendarRestDates(calendar, '2026-08-03', '2026-08-09')), ['2026-08-05']);
  assert.deepEqual(
    Array.from(resolveConfiguredRestDates(null, ['2026-08-04', '2026-08-05'], '2026-08-03', '2026-08-09')).sort(),
    ['2026-08-04', '2026-08-05']
  );
});
