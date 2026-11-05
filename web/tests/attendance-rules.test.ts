import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAttendanceRules, formatAttendanceRules, normalizeAttendanceRules, validateAttendanceRules } from '../src/modules/models-formulas/attendance/attendanceRules';

test('出勤率规则闭环：全勤置顶、区间首尾相接并覆盖 0–100%', () => {
  const legacy = [{ minRate: 0, maxRate: 90, adjustment: -200 }, { minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 100, maxRate: 100, adjustment: 150 }];
  const normalized = normalizeAttendanceRules(legacy);
  assert.deepEqual(normalized, [{ minRate: 100, maxRate: 100, adjustment: 150 }, { minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 90, adjustment: -200 }]);
  assert.deepEqual(normalizeAttendanceRules([]), [{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 100, adjustment: 0 }]);
  assert.equal(validateAttendanceRules(normalized), undefined);
  assert.match(formatAttendanceRules(normalized), /100%（全勤）：增加 150 元/);
  assert.match(formatAttendanceRules(normalized), /0% ≤ 出勤率 < 90%：扣减 200 元/);
});

test('新增规则时按上一条下限生成锁定上限', () => {
  const built = buildAttendanceRules([{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 50, maxRate: 100, adjustment: 10 }, { minRate: 0, maxRate: 50, adjustment: 20 }]);
  assert.deepEqual(built, [{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 50, maxRate: 100, adjustment: 10 }, { minRate: 0, maxRate: 50, adjustment: 20 }]);
  const rebuilt = buildAttendanceRules([{ minRate: 0, maxRate: 0, adjustment: 5 }, { minRate: 40, maxRate: 0, adjustment: 6 }, { minRate: 0, maxRate: 0, adjustment: 7 }]);
  assert.deepEqual(rebuilt, [{ minRate: 100, maxRate: 100, adjustment: 5 }, { minRate: 40, maxRate: 100, adjustment: 6 }, { minRate: 0, maxRate: 40, adjustment: 7 }]);
});

test('出勤率规则拒绝空集、缺全勤、断档、顺序错误和重复全勤', () => {
  assert.match(validateAttendanceRules([]) || '', /至少保留/);
  assert.match(validateAttendanceRules([{ minRate: 100, maxRate: 100, adjustment: 0 }]) || '', /至少保留/);
  assert.match(validateAttendanceRules([{ minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 90, adjustment: 0 }]) || '', /全勤/);
  assert.match(validateAttendanceRules([{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 90, adjustment: 0 }]) || '', /上限必须等于/);
  assert.match(validateAttendanceRules([{ minRate: 0, maxRate: 100, adjustment: 0 }, { minRate: 100, maxRate: 100, adjustment: 0 }]) || '', /全勤/);
  assert.match(validateAttendanceRules([{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 100, maxRate: 100, adjustment: 0 }]) || '', /只能设置一条全勤/);
  assert.match(validateAttendanceRules([{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 50, adjustment: 0 }]) || '', /中间规则/);
  assert.match(validateAttendanceRules([{ minRate: 100, maxRate: 100, adjustment: 0 }, { minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 10, maxRate: 90, adjustment: 0 }]) || '', /最后一条/);
  assert.ok(validateAttendanceRules([{ minRate: 5, maxRate: 5, adjustment: 0 }]));
  assert.ok(validateAttendanceRules([{ minRate: 100, maxRate: 100, adjustment: 0.001 }, { minRate: 0, maxRate: 100, adjustment: 0 }]));
});
