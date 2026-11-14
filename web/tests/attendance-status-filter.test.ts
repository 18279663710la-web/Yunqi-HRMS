import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('考勤明细状态筛选包含出差，顶部正常仍合并出差天数', () => {
  const source = readFileSync(new URL('../src/modules/attendance/AttendanceRecordsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /value: 'travel',\s*label: '出差'/);
  assert.match(source, /\(summary\?\.normal \|\| 0\) \+ \(summary\?\.travel \|\| 0\)/);
});
