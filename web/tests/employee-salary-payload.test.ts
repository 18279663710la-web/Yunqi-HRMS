import assert from 'node:assert/strict';
import test from 'node:test';
import { salaryRecordPayload } from '../src/modules/hr/employee-records/salaryRecordPayload';

test('保存定薪时不提交页面中残留的职务，保留薪资数据及模型版本', () => {
  const payload = salaryRecordPayload({ jobTitle: '旧职务', effectiveDate: '2026-11-01', values: { 基本工资: 5000 }, note: '备注' }, 4);
  assert.deepEqual(payload, { effectiveDate: '2026-11-01', values: { 基本工资: 5000 }, note: '备注', modelVersion: 4 });
});
