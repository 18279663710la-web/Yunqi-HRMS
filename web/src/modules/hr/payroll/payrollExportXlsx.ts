import ExcelJS from 'exceljs';
import type { PayrollExportData } from './payrollExportData';

export async function createPayrollWorkbook(data: PayrollExportData): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('工资明细', { views: [{ state: 'frozen', ySplit: 2 }] });
  sheet.mergeCells(1, 1, 1, data.headers.length);
  const title = sheet.getCell(1, 1);
  title.value = data.title;
  title.font = { bold: true, size: 15 };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 28;
  const header = sheet.addRow(data.headers);
  header.font = { bold: true, color: { argb: 'FF334155' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF2' } };
  data.rows.forEach(values => sheet.addRow(values));
  const total = Array<string | number>(data.headers.length).fill('');
  total[0] = '本批次合计';
  total.splice(data.headers.length - 3, 3, ...data.totals);
  const totalRow = sheet.addRow(total);
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5FB' } };
  sheet.columns.forEach((column, index) => {
    const textWidth = (value: string) => Array.from(value).reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
    const maxWidth = data.rows.reduce((width, row) => Math.max(width, textWidth(String(row[index] ?? ''))), textWidth(data.headers[index]));
    column.width = Math.max(14, Math.min(32, maxWidth + 3));
  });
  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return;
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FFD3D8DF' } }, bottom: { style: 'thin', color: { argb: 'FFD3D8DF' } }, left: { style: 'thin', color: { argb: 'FFD3D8DF' } }, right: { style: 'thin', color: { argb: 'FFD3D8DF' } } };
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
