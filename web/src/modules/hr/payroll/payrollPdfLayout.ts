import type ExcelJS from 'exceljs';

export interface PayrollPdfMerge { top: number; left: number; bottom: number; right: number }
export interface PayrollPdfLayout {
  widths: number[];
  rowHeights: number[];
  merges: PayrollPdfMerge[];
  pages: number[][];
  scale: number;
  left: number;
  top: number;
}

const PAGE_WIDTH = 1122;
const PAGE_HEIGHT = 794;
const address = (value: string) => {
  const match = /^([A-Z]+)([0-9]+)$/.exec(value);
  if (!match) throw new Error('工资表合并单元格格式无效');
  const column = Array.from(match[1]).reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
  return { row: Number(match[2]), column };
};

/** 按工作表列宽、行高和打印边距排版；只按员工行进行纵向分页。 */
export function buildPayrollPdfLayout(sheet: ExcelJS.Worksheet): PayrollPdfLayout {
  const margins = sheet.pageSetup.margins;
  const left = (margins?.left ?? 0.7) * 96;
  const right = (margins?.right ?? 0.7) * 96;
  const top = (margins?.top ?? 0.75) * 96;
  const bottom = (margins?.bottom ?? 0.75) * 96;
  const widths = Array.from({ length: sheet.columnCount }, (_, index) => Math.floor((sheet.getColumn(index + 1).width ?? 10) * 7 + 5));
  const rowHeights = Array.from({ length: sheet.rowCount }, (_, index) => (sheet.getRow(index + 1).height ?? sheet.properties.defaultRowHeight ?? 15) * 4 / 3);
  const headerHeight = rowHeights.slice(0, 4).reduce((a, b) => a + b, 0);
  const maxRow = rowHeights.slice(4).reduce((max, height) => Math.max(max, height), 0);
  const scale = Math.min(1, (PAGE_WIDTH - left - right) / widths.reduce((a, b) => a + b, 0), (PAGE_HEIGHT - top - bottom) / (headerHeight + maxRow));
  const available = (PAGE_HEIGHT - top - bottom) / scale - headerHeight;
  const pages: number[][] = [];
  let current: number[] = [], height = 0;
  for (let index = 4; index < rowHeights.length; index++) {
    if (current.length && height + rowHeights[index] > available + 0.001) { pages.push(current); current = []; height = 0; }
    current.push(index + 1); height += rowHeights[index];
  }
  if (current.length || !pages.length) pages.push(current);
  const merges = sheet.model.merges.map(range => {
    const [start, end] = range.split(':').map(address);
    return { top: start.row, left: start.column, bottom: end.row, right: end.column };
  });
  return { widths, rowHeights, merges, pages, scale, left, top };
}
