import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createPayrollWorkbook } from '../src/modules/hr/payroll/payrollExportXlsx';
import { buildPayrollPdfLayout } from '../src/modules/hr/payroll/payrollPdfLayout';

test('Excel 可读取全部明细、数值和合计，文本按原样存储', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => [`00${i}`, '=文本', 100.25, 100.25]);
  const book = await createPayrollWorkbook({ title: '工资表', periodLabel: '2026（10）月份应发工资奖金补贴及其他', columnNumbers: ['', '', '1', ''], filename: '测试', headers: ['员工号', '姓名', '基本工资', '应发'], rows, totals: [1203] });
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
  assert.equal(sheet.columnCount, 4);
  assert.equal(sheet.getRow(5).getCell(1).value, '000');
  assert.equal(sheet.getRow(5).getCell(2).value, '=文本');
  assert.equal(sheet.getRow(5).getCell(3).value, 100.25);
  assert.equal(sheet.getRow(16).getCell(1).value, '0011');
  assert.equal(sheet.getRow(17).getCell(1).value, '本批次合计');
  assert.equal(sheet.getRow(17).getCell(4).value, 1203);
});

test('长文本行设置足够行高，避免打印时遮住内容', async () => {
  const book = await createPayrollWorkbook({ title: '工资表', periodLabel: '2026（10）月份应发工资奖金补贴及其他', columnNumbers: ['', '1', ''], filename: '测试', headers: ['姓名', '备注', '应发'], rows: [['测试员工', '长文本测试'.repeat(30), 1]], totals: [1] });
  assert.ok((book.getWorksheet('工资明细')!.getRow(5).height ?? 0) >= 200);
});

test('应发列预留合计金额所需宽度', async () => {
  const book = await createPayrollWorkbook({ title: '工资表', periodLabel: '2026（10）月份应发工资奖金补贴及其他', columnNumbers: ['', '1', ''], filename: '测试', headers: ['姓名', '工资', '应发'], rows: [['测试', 1, 1]], totals: [9876543210.12] });
  const sheet = book.getWorksheet('工资明细')!;
  assert.ok(sheet.getColumn(3).width! >= '9876543210.12'.length + 3);
});

test('合计行前三列及中间列分别合并，应发独立加宽，PDF 读取相同合并区域', async () => {
  const headers = ['姓名', '员工号', '职务', '基本工资', '津贴', '奖励', '应发'];
  const book = await createPayrollWorkbook({ title: '工资表', periodLabel: '2026（10）月份应发工资奖金补贴及其他', columnNumbers: ['', '', '', '1', '2', '3', ''], filename: '测试', headers, rows: [['小陈', 'E001', '职员', 100, 20, 5, 125]], totals: [125] });
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(await book.xlsx.writeBuffer());
  const sheet = read.getWorksheet('工资明细')!;
  assert.equal(sheet.getCell('A6').value, '本批次合计');
  assert.equal(sheet.getCell('C6').master.address, 'A6');
  assert.equal(sheet.getCell('F6').master.address, 'D6');
  assert.equal(sheet.getCell('G6').value, 125);
  assert.equal(sheet.getCell('G6').isMerged, false);
  assert.ok(sheet.getColumn(7).width! > sheet.getColumn(4).width!);
  const layout = buildPayrollPdfLayout(sheet);
  assert.ok(layout.merges.some(m => m.top === 6 && m.left === 1 && m.right === 3));
  assert.ok(layout.merges.some(m => m.top === 6 && m.left === 4 && m.right === 6));
});
