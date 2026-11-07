import ExcelJS from 'exceljs';
import type { PayrollExportData } from './payrollExportData';

export async function createPayrollWorkbook(data: PayrollExportData): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('工资明细', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:4' } });
  sheet.mergeCells(1, 1, 1, data.headers.length);
  const title = sheet.getCell(1, 1);
  title.value = data.title;
  title.font = { bold: true, size: 16, name: '宋体' };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 36;
  const fieldCount = data.headers.length - 1;
  const headerFieldCount = data.alignTotalHeaders ? data.headers.length : fieldCount;
  if (headerFieldCount > 1) sheet.mergeCells(2, 1, 2, headerFieldCount);
  sheet.getCell(2, 1).value = data.periodLabel;
  sheet.getRow(2).height = 28;
  sheet.getRow(3).height = 30;
  sheet.getRow(4).height = 22;
  data.headers.forEach((name, index) => {
    const column = index + 1;
    if (index >= headerFieldCount) { sheet.mergeCells(2, column, 4, column); sheet.getCell(2, column).value = name; }
    else {
      sheet.getCell(3, column).value = name;
      if (data.columnNumbers[index]) sheet.getCell(4, column).value = data.columnNumbers[index];
      else sheet.mergeCells(3, column, 4, column);
    }
  });
  data.rows.forEach(values => sheet.addRow(values));
  const total = Array<string | number>(data.headers.length).fill('');
  total[0] = '本批次合计';
  const totalIndexes = data.totalColumnIndexes ?? [data.headers.length - 1];
  totalIndexes.forEach((index, number) => { total[index] = data.totals[number]; });
  if (data.showTotals !== false) {
    const totalRow = sheet.addRow(total);
    totalRow.font = { bold: true };
    const labelColumns = Math.min(3, fieldCount);
    if (labelColumns > 1) sheet.mergeCells(totalRow.number, 1, totalRow.number, labelColumns);
    let start = labelColumns;
    for (let index = labelColumns; index <= data.headers.length; index++) {
      if (index === data.headers.length || totalIndexes.includes(index)) {
        if (index - start > 1) sheet.mergeCells(totalRow.number, start + 1, totalRow.number, index);
        start = index + 1;
      }
    }
  }
  const textWidth = (value: string) => Array.from(value).reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
  sheet.columns.forEach((column, index) => {
    const displayWidth = (value: string | number) => textWidth(typeof value === 'number' ? value.toFixed(2) : value);
    const maxWidth = data.rows.reduce((width, row) => Math.max(width, displayWidth(row[index] ?? '')), Math.max(textWidth(data.headers[index]), displayWidth(total[index])));
    const width = Math.max(10, Math.min(26, maxWidth + 3));
    column.width = index === data.headers.length - 1 ? Math.min(30, Math.max(16, width + 4)) : width;
  });
  data.rows.forEach((values, rowIndex) => {
    const lines = values.reduce<number>((max, value, index) => {
      if (typeof value !== 'string') return max;
      const capacity = Math.max(1, (sheet.getColumn(index + 1).width ?? 10) - 5);
      const count = value.split(/\r\n|\r|\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(textWidth(line) / capacity)), 0);
      return Math.max(max, count);
    }, 1);
    if (lines > 1) sheet.getRow(rowIndex + 5).height = Math.min(409, lines * 16 + 4);
  });
  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FF000000' } }, bottom: { style: 'thin', color: { argb: 'FF000000' } }, left: { style: 'thin', color: { argb: 'FF000000' } }, right: { style: 'thin', color: { argb: 'FF000000' } } };
      if (typeof cell.value === 'number') cell.numFmt = '0.00';
    });
  });
  return workbook;
}

export async function downloadPayrollXlsx(data: PayrollExportData): Promise<void> {
  const workbook = await createPayrollWorkbook(data);
  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${data.filename}.xlsx`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
