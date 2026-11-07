import { jsPDF } from 'jspdf';
import type { PayrollExportData } from './payrollExportData';
import { createPayrollWorkbook } from './payrollExportXlsx';
import { buildPayrollPdfLayout } from './payrollPdfLayout';

/** 使用与 XLSX 相同的工作表及单元格格式，所有列放在同一页宽内。 */
export async function createPayrollPdf(data: PayrollExportData): Promise<jsPDF> {
  const workbook = await createPayrollWorkbook(data);
  const sheet = workbook.getWorksheet('工资明细');
  if (!sheet) throw new Error('工资表生成失败');
  const layout = buildPayrollPdfLayout(sheet);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = 2805; canvas.height = 1985;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法生成 PDF，请更换浏览器后重试');
  const xOffsets = layout.widths.reduce<number[]>((offsets, width) => [...offsets, offsets[offsets.length - 1] + width], [0]);
  const merged = new Map<string, { top: number; left: number; bottom: number; right: number }>();
  for (const merge of layout.merges) {
    for (let row = merge.top; row <= merge.bottom; row++) {
      for (let col = merge.left; col <= merge.right; col++) merged.set(`${row}:${col}`, merge);
    }
  }
  const wrap = (text: string, width: number) => {
    const result: string[] = [];
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      let line = '';
      for (const char of Array.from(paragraph)) {
        if (line && ctx.measureText(line + char).width > width) { result.push(line); line = char; }
        else line += char;
      }
      result.push(line);
    }
    return result;
  };
  for (const [pageIndex, bodyRows] of layout.pages.entries()) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(canvas.width / 1122, canvas.height / 794);
    ctx.translate(layout.left, layout.top);
    ctx.scale(layout.scale, layout.scale);
    const rowNumbers = [1, 2, 3, 4, ...bodyRows];
    let y = 0;
    for (const rowNumber of rowNumbers) {
      const rowHeight = layout.rowHeights[rowNumber - 1];
      for (let col = 1; col <= layout.widths.length; col++) {
        const merge = merged.get(`${rowNumber}:${col}`);
        if (merge && (merge.top !== rowNumber || merge.left !== col)) continue;
        const cell = sheet.getCell(rowNumber, col);
        const x = xOffsets[col - 1];
        const width = xOffsets[merge?.right ?? col] - x;
        const height = merge ? layout.rowHeights.slice(merge.top - 1, merge.bottom).reduce((a, b) => a + b, 0) : rowHeight;
        if (cell.border && Object.values(cell.border).some(border => border?.style)) {
          ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x, y, width, height);
        }
        if (cell.value === null || cell.value === undefined) continue;
        const text = typeof cell.value === 'number' && cell.numFmt === '0.00' ? cell.value.toFixed(2) : String(cell.value);
        const fontSize = (cell.font?.size ?? 11) * 4 / 3;
        const family = cell.font?.name ? `"${cell.font.name.replace(/["\\]/g, '')}"` : '"宋体"';
        ctx.font = `${cell.font?.bold ? 'bold ' : ''}${fontSize}px ${family}, "SimSun", serif`;
        const lines = cell.alignment?.wrapText ? wrap(text, Math.max(1, width - 8)) : [text];
        const lineHeight = fontSize * 1.2;
        ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, width - 2, height - 2); ctx.clip();
        ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        const start = y + (height - lines.length * lineHeight) / 2 + lineHeight / 2;
        lines.forEach((line, index) => ctx.fillText(line, x + width / 2, start + index * lineHeight));
        ctx.restore();
      }
      y += rowHeight;
    }
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return pdf;
}

export async function downloadPayrollPdf(data: PayrollExportData): Promise<void> {
  const pdf = await createPayrollPdf(data);
  pdf.save(`${data.filename}.pdf`);
}
