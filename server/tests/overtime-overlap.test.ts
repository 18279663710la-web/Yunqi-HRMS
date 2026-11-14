import assert from 'node:assert/strict';
import test from 'node:test';
import { overtimeConflictMessage, overtimeInterval } from '../src/domains/approvals/overtimeOverlap';

test('加班时段按半开区间判断交叉，待审批和已通过分别提示', () => {
  const current = overtimeInterval({ date: '2026-11-15', startTime: '18:00', endTime: '22:00' });
  assert.deepEqual(current, { start: '2026-11-15 18:00', end: '2026-11-15 22:00' });
  assert.equal(overtimeInterval({ date: '2026-11-15', startTime: '22:00', endTime: '18:00' }), null);
  assert.equal(overtimeInterval([{ label: '加班日期', value: '2026-11-15' }, { label: '开始时间', value: '18:00' }, { label: '结束时间', value: '22:00' }])?.start, '2026-11-15 18:00');
  const rows = [
    { status: 'rejected', form: [{ label: '加班日期', value: '2026-11-15' }, { label: '开始时间', value: '18:00' }, { label: '结束时间', value: '21:00' }] },
    { status: 'approved', form: [{ label: '加班日期', value: '2026-11-15' }, { label: '开始时间', value: '22:00' }, { label: '结束时间', value: '23:00' }] },
    { status: 'pending', form: [{ label: '加班日期', value: '2026-11-16' }, { label: '开始时间', value: '09:00' }, { label: '结束时间', value: '12:00' }] },
  ];
  assert.equal(overtimeConflictMessage(current!, rows), null);
  const pending = { status: 'pending', form: [{ label: '加班日期', value: '2026-11-15' }, { label: '开始时间', value: '21:00' }, { label: '结束时间', value: '23:00' }] };
  assert.match(overtimeConflictMessage(current!, [...rows, pending]) ?? '', /撤回/);
  const approved = { status: 'approved', form: [{ label: '加班日期', value: '2026-11-15' }, { label: '开始时间', value: '17:00' }, { label: '结束时间', value: '18:30' }] };
  assert.match(overtimeConflictMessage(current!, [...rows, approved]) ?? '', /已通过/);
  assert.doesNotMatch(overtimeConflictMessage(current!, [...rows, approved]) ?? '', /撤回/);
});
