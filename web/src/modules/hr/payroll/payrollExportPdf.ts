import { jsPDF } from 'jspdf';
import { splitPayrollColumns, type PayrollExportCell, type PayrollExportData } from './payrollExportData';

// 使用浏览器字体绘制中文，避免依赖用户设备上特定的字体文件。
export async function downloadPayrollPdf(data: PayrollExportData): Promise<void> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = 1684; canvas.height = 1190;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法生成 PDF，请更换浏览器后重试');
  const left = 52, right = 1632, bottom = 1120, lineHeight = 25;
  let pages = 0;
  const printable = (value: PayrollExportCell) => typeof value === 'number' ? value.toFixed(2) : value;
  const wrap = (text: string, width: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      let line = '';
      for (const char of Array.from(paragraph)) {
        if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = char; }
        else line += char;
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  };
  const flush = async () => {
    pages++;
    ctx.fillStyle = '#64748b'; ctx.font = '18px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'right'; ctx.fillText(`第 ${pages} 页`, right, 1160);
    if (pages > 1) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  const totals: PayrollExportCell[] = Array(data.headers.length).fill('');
  totals[0] = '本批次合计';
  totals.splice(data.headers.length - 3, 3, ...data.totals);
  for (const [group, columns] of splitPayrollColumns(data.headers, 9).entries()) {
    const width = (right - left) / columns.length;
    let y = 0;
    const begin = () => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#17243a'; ctx.font = 'bold 30px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.fillText(data.title, left, 56);
      ctx.textAlign = 'right'; ctx.font = '19px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.fillText(`字段分组 ${group + 1}`, right, 56);
      ctx.font = 'bold 21px "Microsoft YaHei", "PingFang SC", sans-serif';
      const headerLines = columns.map(index => wrap(data.headers[index], width - 16));
      const height = Math.max(...headerLines.map(lines => lines.length)) * lineHeight + 16;
      y = 92;
      columns.forEach((_, i) => {
        const x = left + i * width;
        ctx.fillStyle = '#e9edf2'; ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = '#cbd2db'; ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = '#334155'; ctx.textAlign = 'center';
        headerLines[i].forEach((line, lineIndex) => ctx.fillText(line, x + width / 2, y + 8 + lineHeight * (lineIndex + 0.5)));
      });
      y += height;
    };
    begin();
    for (const [rowIndex, row] of [...data.rows, totals].entries()) {
      ctx.font = '21px "Microsoft YaHei", "PingFang SC", sans-serif';
      const lines = columns.map((index, i) => wrap(rowIndex === data.rows.length && i === 0 ? '本批次合计' : printable(row[index] ?? ''), width - 16));
      let offset = 0;
      const totalLines = Math.max(...lines.map(line => line.length));
      while (offset < totalLines) {
        let available = Math.floor((bottom - y - 12) / lineHeight);
        if (available < 1) { await flush(); begin(); available = Math.floor((bottom - y - 12) / lineHeight); }
        const count = Math.min(available, totalLines - offset);
        const height = count * lineHeight + 12;
        columns.forEach((column, i) => {
          const x = left + i * width;
          ctx.fillStyle = rowIndex === data.rows.length ? '#f1f5fb' : rowIndex % 2 ? '#f8fafc' : '#fff';
          ctx.fillRect(x, y, width, height); ctx.strokeStyle = '#cbd2db'; ctx.strokeRect(x, y, width, height);
          ctx.fillStyle = '#1e293b'; ctx.textAlign = 'center'; ctx.font = '21px "Microsoft YaHei", "PingFang SC", sans-serif';
          const identity = data.headers[column] === '姓名' || data.headers[column] === '员工号';
          const visibleLines = offset > 0 && identity && lines[i].length <= offset ? [lines[i][0]] : lines[i].slice(offset, offset + count);
          visibleLines.forEach((line, lineIndex) => ctx.fillText(line, x + width / 2, y + 6 + lineHeight * (lineIndex + 0.5)));
        });
        y += height; offset += count;
      }
    }
    await flush();
  }
  pdf.save(`${data.filename}.pdf`);
}
