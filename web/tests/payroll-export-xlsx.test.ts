import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createPayrollWorkbook } from '../src/modules/hr/payroll/payrollExportXlsx';

test('Excel 可读取全部明细、数值和合计，文本按原样存储', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => [`00${i}`, '=文本', 100.25, 100.25, 2, 98.25]);
  const book = await createPayrollWorkbook({ title: '工资表', periodLabel: '2026（10）月份应发工资奖金补贴及其他', columnNumbers: ['', '', '1', '', '', ''], filename: '测试', headers: ['员工号', '姓名', '基本工资', '应发', '扣除', '实发'], rows, totals: [1203, 24, 1179] });
  const bytes = await book.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(bytes);
  const sheet = read.getWorksheet('工资明细')!;
  assert.equal(sheet.getCell('A1').value, '工资表');
  assert.equal(sheet.getCell('A1').alignment.horizontal, 'center');
  assert.equal(sheet.getCell('A2').value, '2026（10）月份应发工资奖金补贴及其他');
  assert.equal(sheet.getCell('A3').value, '员工号');
  assert.equal(sheet.getCell('A4').value, '员工号');
  assert.equal(sheet.getCell('C3').value, '基本工资');
  assert.equal(sheet.getCell('C4').value, '1');
  assert.equal(sheet.getCell('D2').value, '应发');
  assert.equal(sheet.getRow(5).getCell(1).value, '000');
  assert.equal(sheet.getRow(5).getCell(2).value, '=文本');
  assert.equal(sheet.getRow(5).getCell(3).value, 100.25);
  assert.equal(sheet.getRow(16).getCell(1).value, '0011');
  assert.equal(sheet.getRow(17).getCell(1).value, '本批次合计');
  assert.equal(sheet.getRow(17).getCell(4).value, 1203);
});

test('长文本行设置足够行高，避免打印时遮住内容', async () => {
  const book = await createPayrollWorkbook({ title: '工资表', periodLabel: '2026（10）月份应发工资奖金补贴及其他', columnNumbers: ['', '1', '', '', ''], filename: '测试', headers: ['姓名', '备注', '应发', '扣除', '实发'], rows: [['测试员工', '长文本测试'.repeat(30), 1, 0, 1]], totals: [1, 0, 1] });
  assert.ok((book.getWorksheet('工资明细')!.getRow(5).height ?? 0) >= 200);
});

test('应发、扣除和实发列预留合计金额所需宽度', async () => {
  const book = await createPayrollWorkbook({ title: '工资表', periodLabel: '2026（10）月份应发工资奖金补贴及其他', columnNumbers: ['', '1', '', '', ''], filename: '测试', headers: ['姓名', '工资', '应发', '扣除', '实发'], rows: [['测试', 1, 1, 0, 1]], totals: [9876543210.12, 0, 9876543210.12] });
  const sheet = book.getWorksheet('工资明细')!;
  assert.ok(sheet.getColumn(3).width! >= '9876543210.12'.length + 3);
  assert.ok(sheet.getColumn(5).width! >= '9876543210.12'.length + 3);
});
