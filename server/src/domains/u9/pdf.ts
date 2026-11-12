import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { U9Document, U9DocumentKind, U9ReceiptDocument } from './types';
import { HttpError } from '../../shared/utils/errors';
import { formatMoney } from './money';

function fontPath(): string {
  const candidates = [process.env.U9_PDF_FONT, process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts', 'simhei.ttf'), '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'];
  const font = candidates.find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));
  if (!font) throw new HttpError(503, 503, '未配置可用的中文字体');
  return font;
}

interface Column { title: string; width: number; align?: 'left' | 'right' }
async function tablePdf(title: string, meta: string[], columns: Column[], rows: string[][]): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margin: 40, info: { Title: title } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  pdf.font(fontPath());
  const startX = 40;
  const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const header = () => {
    pdf.fontSize(16).fillColor('#18243b').text(title, startX, 40, { width: totalWidth, align: 'center' });
    pdf.fontSize(9).fillColor('#526174');
    let y = 75;
    for (const line of meta) { pdf.text(line, startX, y, { width: totalWidth }); y += 19; }
    y += 4;
    pdf.rect(startX, y, totalWidth, 27).fill('#edf1f7');
    let x = startX;
    pdf.fillColor('#27364e').fontSize(9);
    for (const col of columns) { pdf.text(col.title, x + 6, y + 8, { width: col.width - 12, align: col.align || 'left' }); x += col.width; }
    return y + 27;
  };
  let y = header();
  for (const row of rows.length ? rows : [columns.map((_, index) => index === 0 ? '暂无数据' : '')]) {
    pdf.fontSize(9);
    const height = Math.max(28, ...columns.map((col, index) => pdf.heightOfString(row[index] || '', { width: col.width - 12 }) + 14));
    if (y + height > pdf.page.height - 40) { pdf.addPage(); y = header(); }
    let x = startX;
    pdf.fillColor('#263449');
    columns.forEach((col, index) => {
      pdf.text(row[index] || '', x + 6, y + 7, { width: col.width - 12, align: col.align || 'left', lineBreak: true });
      x += col.width;
    });
    pdf.moveTo(startX, y + height).lineTo(startX + totalWidth, y + height).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    y += height;
  }
  pdf.end();
  return result;
}

function sumAmounts(values: Array<string | undefined>): string {
  const scale = 1000000000n;
  let sum = 0n;
  for (const value of values) {
    const match = /^(-?)(\d+)(?:\.(\d{0,9}))?$/.exec(value || '');
    if (!match) throw new Error('U9 单据金额格式无效');
    const amount = BigInt(match[2]) * scale + BigInt((match[3] || '').padEnd(9, '0'));
    sum += match[1] ? -amount : amount;
  }
  const absolute = sum < 0 ? -sum : sum;
  return `${sum < 0 ? '-' : ''}${absolute / scale}.${String(absolute % scale).padStart(9, '0')}`;
}

function receiptPdf(document: U9ReceiptDocument): Promise<Buffer> {
  return tablePdf('收款单', [
    `单号：${document.docNo}    收款日期：${document.businessDate || '-'}`,
    `客户：${document.customer || '-'}    总金额：${document.totalAmount || '-'} 元`,
  ], [
    { title: '行号', width: 40 },
    { title: '结算方式', width: 60 },
    { title: '流水号', width: 205 },
    { title: '金额(元)', width: 75, align: 'right' },
    { title: '银行账号', width: 135 },
  ], document.lines.map(line => [
    String(line.lineNum),
    line.settlementMethod || '-',
    line.noteNo || '-',
    line.amount,
    line.bankAccount || '-',
  ]));
}

export function documentPdf(kind: U9DocumentKind, document: U9Document): Promise<Buffer> {
  if (kind === 'receipts') return receiptPdf(document as U9ReceiptDocument);
  const lines = Array.isArray(document.lines) ? document.lines as Array<{ shipNo?: string; amount?: string }> : [];
  return tablePdf('应收单', [
    `单号：${document.docNo}    日期：${document.date || '-'}`,
    `客户：${document.customer || '-'}    币种：${document.currency || '-'}    归属合计：${formatMoney(sumAmounts(lines.map(line => line.amount)), document.currencyPrecision ?? 2)}`,
  ], [{ title: '出货单号', width: 300 }, { title: '归属金额', width: 215, align: 'right' }],
  lines.map(line => [line.shipNo || '-', formatMoney(line.amount, document.currencyPrecision ?? 2)]));
}

function summaryMonths(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const months: string[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

function groupThousands(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] ? `.${match[3]}` : ''}`;
}

function summaryMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return groupThousands(formatMoney(value, 2));
}

interface SummaryGroup {
  code: string;
  name: string;
  saleser: string;
  carry: string | null;
  months: Map<string, string | null>;
}

export function summaryPdf(from: string, to: string, rows: Record<string, unknown>[]): Promise<Buffer> {
  const months = summaryMonths(from, to);
  const groups = new Map<string, SummaryGroup>();
  for (const row of rows) {
    const code = String(row.CustomerCode ?? '');
    if (!code) continue;
    let group = groups.get(code);
    if (!group) {
      group = {
        code,
        name: String(row.CustomerName || '-'),
        saleser: String(row.Saleser || '-'),
        carry: null,
        months: new Map(),
      };
      groups.set(code, group);
    }
    const display = String(row.DisplayName || '');
    const value = row.UnRecMoney === null || row.UnRecMoney === undefined || row.UnRecMoney === '' ? null : String(row.UnRecMoney);
    if (display === '承上' || Number(row.RowNum) === 0) group.carry = value;
    else if (/^\d{4}-\d{2}$/.test(display)) group.months.set(display, value);
  }

  const pdf = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 30, info: { Title: '应收款汇总表' } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  pdf.font(fontPath());

  const margin = 30;
  const contentWidth = pdf.page.width - margin * 2;
  const fixedWidths = [210, 60, 70, 85, 85];
  const monthWidth = months.length ? (contentWidth - fixedWidths.reduce((sum, width) => sum + width, 0)) / months.length : 0;
  const widths = [fixedWidths[0], fixedWidths[1], fixedWidths[2], fixedWidths[3], ...months.map(() => monthWidth), fixedWidths[4]];
  const headers = ['客户', '客户代码', '业务员', '承上', ...months, '合计'];
  const aligns: Array<'left' | 'right'> = ['left', 'left', 'left', 'right', ...months.map(() => 'right' as const), 'right'];

  const rowHeight = (values: string[], header: boolean): number => {
    pdf.fontSize(header ? 8.5 : 8);
    return Math.max(header ? 24 : 22, ...values.map((text, index) => pdf.heightOfString(text || '', { width: widths[index] - 6, align: aligns[index] }) + 8));
  };
  const drawRow = (y: number, values: string[], header: boolean): number => {
    const height = rowHeight(values, header);
    let x = margin;
    pdf.fontSize(header ? 8.5 : 8);
    for (let index = 0; index < values.length; index += 1) {
      pdf.lineWidth(0.6).rect(x, y, widths[index], height).fillAndStroke(header ? '#ffff00' : '#ffffff', '#000000');
      pdf.fillColor('#000000').text(values[index] || '', x + 3, y + 4, { width: widths[index] - 6, align: aligns[index], lineBreak: true });
      x += widths[index];
    }
    return y + height;
  };

  pdf.fontSize(18).fillColor('#000000').text('应收款汇总表', margin, margin, { width: contentWidth, align: 'left' });
  pdf.fontSize(9).text(`${from} 到 ${to}`, margin, margin + 30, { width: contentWidth, align: 'left' });
  let y = drawRow(margin + 55, headers, true);
  if (!groups.size) {
    y = drawRow(y, ['暂无数据', '', '', '', ...months.map(() => ''), ''], false);
  } else {
    for (const group of groups.values()) {
      const values = [
        group.name, group.code, group.saleser, summaryMoney(group.carry),
        ...months.map(month => summaryMoney(group.months.get(month))),
      ];
      const amounts = [group.carry, ...months.map(month => group.months.get(month))].filter((value): value is string => !!value);
      values.push(amounts.length ? groupThousands(formatMoney(sumAmounts(amounts), 2)) : '');
      const height = rowHeight(values, false);
      if (y + height > pdf.page.height - margin) {
        pdf.addPage();
        y = drawRow(margin, headers, true);
      }
      y = drawRow(y, values, false);
    }
  }
  pdf.end();
  return result;
}
