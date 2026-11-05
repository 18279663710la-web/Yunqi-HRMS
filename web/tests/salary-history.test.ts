import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHrHistory } from '../src/utils/salaryHistory';

test('薪资历史优先展示模型字段并跳过镜像', () => {
  const text = formatHrHistory({
    effectiveDate: '2026-11-01',
    values: { 基础薪资: 4000, 固定补贴: 500 },
    base: 4000,
    allowance: 500,
    performance: 0,
    modelVersion: 2,
    attendanceRules: [],
    note: '',
  }, 'salary');
  assert.ok(text.includes('基础薪资：4000'));
  assert.ok(text.includes('固定补贴：500'));
  assert.ok(!text.includes('基本工资'));
  assert.ok(!text.includes('绩效工资'));
  assert.ok(!text.includes('modelVersion'));
});

test('旧薪资记录沿用旧字段标签', () => {
  const text = formatHrHistory({ effectiveDate: '2026-11-01', base: 4000, allowance: 500, performance: 4000 }, 'salary');
  assert.ok(text.includes('基本工资：4000'));
  assert.ok(text.includes('固定补贴：500'));
  assert.ok(text.includes('绩效工资：4000'));
});

test('合同历史仍使用原有标签', () => {
  const text = formatHrHistory({ number: 'C-1', startDate: '2026-01-01', endDate: '2027-01-01' }, 'contract');
  assert.ok(text.includes('合同编号：C-1'));
  assert.ok(text.includes('开始日期：2026-01-01'));
});
