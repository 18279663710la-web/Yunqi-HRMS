import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollExportData, splitPayrollColumns } from '../src/modules/hr/payroll/payrollExportData';
import type { PayrollBatch, PayrollBatchItem, SalaryComponentModel } from '../src/modules/hr/api';

const batch: PayrollBatch = { id: 1, month: '2026-10', status: 'draft', createdAt: '', reviewedAt: null };
const model: SalaryComponentModel = { version: 1, fixedFields: [
  { name: '姓名', type: 'text', required: true }, { name: '员工号', type: 'text', required: true },
  { name: '职务', type: 'text', required: true }, { name: '基本工资', type: 'number', required: true },
], extendedFields: [{ name: '补贴', type: 'number', required: false }], fieldOrder: ['姓名', '基本工资', '员工号', '补贴', '职务'] };
const row = (id: number): PayrollBatchItem => ({ id, employeeId: String(id), name: `员工${id}`, employeeNo: `00${id}`, position: '职位', gross: 100.1, baseGross: 100, attendanceRate: null, attendanceAdjustment: 0, overtimeSeconds: 0, overtimePay: 0, deductions: 0.05, net: 100.05, note: '', modelSnapshot: { version: 1, revision: 0, position: '快照职位', fixedTotal: 100, fixed: [{ name: '基本工资', value: 100 }], extended: [{ name: '补贴', value: 0, category: 'income' }, { name: '历史字段', value: '=测试', category: 'info' }] } });

test('导出全部员工，按模型顺序及历史字段生成数值、文本和准确合计', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(i + 1));
  rows[1].modelSnapshot = null;
  const result = buildPayrollExportData(batch, rows, model);
  assert.deepEqual(result.headers, ['姓名', '基本工资', '员工号', '补贴', '职务', '历史字段', '应发', '扣除', '实发']);
  assert.equal(result.rows.length, 12);
  assert.deepEqual(result.rows[0], ['员工1', 100, '001', 0, '快照职位', '=测试', 100.1, 0.05, 100.05]);
  assert.deepEqual(result.rows[1], ['员工2', '—', '002', '—', '职位', '—', 100.1, 0.05, 100.05]);
  assert.deepEqual(result.totals, [1201.2, 0.6, 1200.6]);
});

test('PDF 横向分页重复身份字段，其他字段按顺序全部输出', () => {
  const headers = ['姓名', '基本工资', '员工号', '补贴', '职务', '历史字段', '应发', '扣除', '实发'];
  const chunks = splitPayrollColumns(headers, 5);
  assert.deepEqual(chunks, [[0, 1, 2, 3, 4], [0, 2, 5, 6, 7], [0, 2, 8]]);
});
