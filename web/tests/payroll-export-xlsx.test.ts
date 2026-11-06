import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createPayrollWorkbook } from '../src/modules/hr/payroll/payrollExportXlsx';

test('Excel 可读取全部明细、数值和合计，文本按原样存储', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => [`00${i}`, '=文本', 100.25, 2, 98.25]);
  const book = await createPayrollWorkbook({ title: '2026-10 工资批次 · 草稿', filename: '测试', headers: ['员工号', '姓名', '应发', '扣除', '实发'], rows, totals: [1203, 24, 1179] });
  const bytes = await book.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(bytes);
  const sheet = read.getWorksheet('工资明细')!;
  assert.equal(sheet.getRow(2).getCell(1).value, '员工号');
  assert.equal(sheet.getRow(3).getCell(1).value, '000');
  assert.equal(sheet.getRow(3).getCell(2).value, '=文本');
  assert.equal(sheet.getRow(3).getCell(3).value, 100.25);
  assert.equal(sheet.getRow(14).getCell(1).value, '0011');
  assert.equal(sheet.getRow(15).getCell(1).value, '本批次合计');
  assert.equal(sheet.getRow(15).getCell(3).value, 1203);
});
