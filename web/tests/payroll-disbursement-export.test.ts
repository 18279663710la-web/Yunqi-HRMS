import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDisbursementExportData, buildPayslipExportData } from '../src/modules/hr/payroll/payrollDisbursementExport';
import { createPayrollWorkbook } from '../src/modules/hr/payroll/payrollExportXlsx';
import { buildPayrollPdfLayout } from '../src/modules/hr/payroll/payrollPdfLayout';
import type { PayrollBatch, PayrollBatchItem, SalaryComponentModel, DisbursementState } from '../src/modules/hr/api';

test('工资发放输出包含全部补充项、应发和实发及各自合计', async () => {
  const batch: PayrollBatch = { id: 1, month: '2026-10', status: 'reviewed', createdAt: '', reviewedAt: '' };
  const model: SalaryComponentModel = { version: 1, fixedFields: [{ name: '姓名', type: 'text', required: true }, { name: '员工号', type: 'text', required: true }, { name: '职务', type: 'text', required: true }], extendedFields: [] };
  const item: PayrollBatchItem = { id: 1, employeeId: 'U1', name: '员工', employeeNo: 'E1', position: '岗位', gross: 100.1, baseGross: 100, attendanceRate: null, attendanceAdjustment: 0, overtimeSeconds: 0, overtimePay: 0, deductions: 5, net: 95.1, note: '', modelSnapshot: null };
  const state: DisbursementState = { fields: [{ id: 5, name: '补扣', category: 'deduction', required: true, displaySetting: 'none' }, { id: 6, name: '补贴', category: 'income', required: true, displaySetting: 'none' }], rows: [{ itemId: 1, net: 85.1, values: [{ fieldId: 5, value: 20, revision: 1 }, { fieldId: 6, value: 5, revision: 1 }] }], revision: 'v', issued: false };
  const result = buildDisbursementExportData(batch, [item], model, state);
  assert.deepEqual(result.headers, ['姓名', '员工号', '职务', '补扣', '补贴', '应发', '实发']);
  assert.deepEqual(result.rows, [['员工', 'E1', '岗位', 20, 5, 100.1, 85.1]]);
  assert.deepEqual(result.totals, [100.1, 85.1]);
  const sheet = (await createPayrollWorkbook(result)).getWorksheet('工资明细')!;
  assert.deepEqual(result.totalColumnIndexes, [5, 6]);
  assert.equal(sheet.getCell('D3').value, '补扣');
  assert.equal(sheet.getCell('E3').value, '补贴');
  assert.equal(sheet.getCell('F3').value, '应发');
  assert.equal(sheet.getCell('G2').master.address, 'A2');
  assert.equal(sheet.getCell('G3').value, '实发');
  assert.equal(sheet.getCell('F4').master.address, 'F3');
  assert.equal(sheet.getCell('G4').master.address, 'G3');
  assert.equal(sheet.getCell('D5').value, 20);
  assert.equal(sheet.getCell('F6').value, 100.1);
  assert.equal(sheet.getCell('G6').value, 85.1);
  const layout = buildPayrollPdfLayout(sheet);
  assert.equal(layout.widths.length, 7);
  assert.ok(layout.merges.some(merge => merge.top === 3 && merge.bottom === 4 && merge.left === 6 && merge.right === 6));
  assert.ok(layout.merges.some(merge => merge.top === 3 && merge.bottom === 4 && merge.left === 7 && merge.right === 7));
});


test('个人工资条仅包含指定员工的字段和金额，不含批次合计', async () => {
  const batch: PayrollBatch = { id: 7, month: '2026-10', status: 'reviewed', createdAt: '', reviewedAt: '' };
  const model: SalaryComponentModel = { version: 1, fixedFields: [{ name: '姓名', type: 'text', required: true }, { name: '员工号', type: 'text', required: true }, { name: '职务', type: 'text', required: true }], extendedFields: [] };
  const item: PayrollBatchItem = { id: 10, employeeId: 'U1', name: '甲', employeeNo: 'E1', position: '岗位', gross: 100, baseGross: 100, attendanceRate: null, attendanceAdjustment: 0, overtimeSeconds: 0, overtimePay: 0, deductions: 0, net: 100, note: '', modelSnapshot: null };
  const state: DisbursementState = { fields: [{ id: 5, name: '补扣', category: 'deduction', required: true, displaySetting: 'none' }], rows: [{ itemId: 10, net: 90, values: [{ fieldId: 5, value: 10, revision: 1 }] }, { itemId: 11, net: 8888, values: [{ fieldId: 5, value: 999, revision: 1 }] }] };
  const data = buildPayslipExportData(batch, item, model, state);
  assert.deepEqual(data.rows, [['甲', 'E1', '岗位', 10, 100, 90]]);
  assert.deepEqual(data.totals, [100, 90]);
  assert.equal(data.title, '工资条');
  const sheet = (await createPayrollWorkbook(data)).getWorksheet('工资明细')!;
  assert.equal(sheet.rowCount, 5);
  assert.deepEqual(buildPayrollPdfLayout(sheet).pages, [[5]]);
  assert.ok(!JSON.stringify(data).includes('8888'));
  assert.throws(() => buildPayslipExportData(batch, item, model, { ...state, rows: state.rows.slice(1) }), /不完整/);
});
