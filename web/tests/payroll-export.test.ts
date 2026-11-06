import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollExportData } from '../src/modules/hr/payroll/payrollExportData';
import { buildPayrollPdfLayout } from '../src/modules/hr/payroll/payrollPdfLayout';
import { createPayrollWorkbook } from '../src/modules/hr/payroll/payrollExportXlsx';
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
  assert.equal(result.title, '工资表');
  assert.equal(result.periodLabel, '2026（10）月份应发工资奖金补贴及其他');
  assert.deepEqual(result.columnNumbers, ['', '1', '', '2', '', '3', '']);
  assert.deepEqual(result.headers, ['姓名', '基本工资', '员工号', '补贴', '职务', '历史字段', '应发']);
  assert.equal(result.rows.length, 12);
  assert.deepEqual(result.rows[0], ['员工1', 100, '001', 0, '快照职位', '=测试', 100.1]);
  assert.deepEqual(result.rows[1], ['员工2', '—', '002', '—', '职位', '—', 100.1]);
  assert.deepEqual(result.totals, [1201.2]);
});

test('PDF 从工资工作表读取所有列宽和合并区域，横向保持整表', async () => {
  const data = buildPayrollExportData(batch, [row(1)], model);
  const sheet = (await createPayrollWorkbook(data)).getWorksheet('工资明细')!;
  sheet.getColumn(2).width = 22;
  sheet.getRow(5).height = 35;
  const layout = buildPayrollPdfLayout(sheet);
  assert.equal(layout.widths.length, data.headers.length);
  assert.ok(layout.widths[1] > layout.widths[0]);
  assert.equal(layout.rowHeights[4], 35 * 4 / 3);
  assert.ok(layout.merges.some(merge => merge.top === 1 && merge.left === 1 && merge.right === data.headers.length));
  assert.deepEqual(layout.pages, [[5, 6]]);
});

test('员工较多时只沿纵向分页，所有列及每条明细均保留', async () => {
  const data = buildPayrollExportData(batch, Array.from({ length: 150 }, (_, index) => row(index + 1)), model);
  const sheet = (await createPayrollWorkbook(data)).getWorksheet('工资明细')!;
  const layout = buildPayrollPdfLayout(sheet);
  assert.ok(layout.pages.length > 1);
  assert.deepEqual(layout.pages.flat(), Array.from({ length: 151 }, (_, index) => index + 5));
  assert.equal(layout.widths.length, data.headers.length);
});
