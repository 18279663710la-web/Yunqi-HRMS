import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { U9DocumentKind, U9ReceiptDocument, U9ReceivableDocument } from './types';
import { HttpError } from '../../shared/utils/errors';
import { formatMoney } from './money';

function fontPath(): string {
  // 业务 PDF 统一使用宋体；pdfkit 无法嵌入 .ttc 集合字体（simsun.ttc 会报错），
  // 因此使用独立的华文宋体 STSONG.TTF；U9_PDF_FONT 可覆盖，缺失时回退黑体/文泉驿
  const candidates = [
    process.env.U9_PDF_FONT,
    process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts', 'STSONG.TTF'),
    process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts', 'simhei.ttf'),
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  ];
  const font = candidates.find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));
  if (!font) throw new HttpError(503, 503, '未配置可用的中文字体');
  return font;
}

/**
 * 业务模块 PDF 统一样式，与工资发放模块导出的工资表一致：
 * 宋体 11pt、单元格水平垂直居中并自动换行、细黑框、白底、无行编号、无其他颜色；
 * 页面 A4/A3 横向，左右边距 0.7 英寸、上下 0.75 英寸。
 * fitWidth：列宽同比缩放到页宽（单据列表）；minWidth：列宽不低于声明值，页宽不够则加宽页面（汇总多月）。
 */
interface GridColumn { title: string; width: number }
type GridSize = 'A4' | 'A3';
type GridFit = 'fitWidth' | 'minWidth';
const CELL_FONT = 11;
const CELL_LINE = CELL_FONT * 1.2;
const TITLE_FONT = 16;
/** PDFKit A3 横向点数 */
const A3_LANDSCAPE: [number, number] = [1190.55, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

async function gridPdf(
  title: string,
  topRow: string,
  columns: GridColumn[],
  rows: string[][],
  size: GridSize,
  fit: GridFit = 'fitWidth'
): Promise<Buffer> {
  const left = 50.4;
  const top = 54;
  const bottom = 54;
  const naturalWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const basePage = size === 'A3' ? A3_LANDSCAPE : A4_LANDSCAPE;
  const pageWidth =
    fit === 'minWidth' ? Math.max(basePage[0], naturalWidth + left * 2) : basePage[0];
  const pageHeight = basePage[1];
  const pdf = new PDFDocument({
    size: [pageWidth, pageHeight],
    margin: 30,
    info: { Title: title },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  pdf.font(fontPath());
  const contentWidth = pdf.page.width - left * 2;
  let widths: number[];
  if (fit === 'minWidth') {
    // 声明宽度为下限；总宽小于页内容区时同比放大填满，绝不压窄
    const scaleUp = contentWidth > naturalWidth ? contentWidth / naturalWidth : 1;
    widths = columns.map((col) => col.width * scaleUp);
  } else {
    const scale = contentWidth / Math.max(naturalWidth, 1);
    widths = columns.map((col) => col.width * scale);
  }

  const wrappedLines = (text: string, width: number): number =>
    Math.max(1, Math.ceil(pdf.heightOfString(text || '', { width: Math.max(1, width - 8) }) / CELL_LINE));
  // 标题在工资表中加粗，宋体无粗体变体时以微偏移双绘模拟
  const drawBoldCentered = (text: string, y: number, fontSize: number, height: number): void => {
    pdf.fontSize(fontSize);
    for (const offset of [0.4, 0]) {
      pdf.text(text, left + offset, y + (height - fontSize * 1.2) / 2, { width: contentWidth, align: 'center', lineBreak: false, lineGap: 0 });
    }
  };
  const drawCellText = (text: string, x: number, y: number, width: number, height: number): void => {
    const lines = wrappedLines(text, width);
    pdf.fontSize(CELL_FONT).fillColor('#000000').text(text || '', x + 4, y + (height - lines * CELL_LINE) / 2, {
      width: Math.max(1, width - 8),
      align: 'center',
      lineBreak: true,
      lineGap: 0,
    });
  };
  const drawBand = (y: number, values: string[], kind: 'top' | 'head' | 'cell'): number => {
    if (kind === 'top') {
      pdf.lineWidth(0.75).rect(left, y, contentWidth, 28).fillAndStroke('#ffffff', '#000000');
      drawCellText(values[0] || '', left, y, contentWidth, 28);
      return y + 28;
    }
    const height = kind === 'head' ? 30 : Math.max(15, ...widths.map((width, index) => wrappedLines(values[index] || '', width) * 16 + 4));
    let x = left;
    columns.forEach((col, index) => {
      pdf.lineWidth(0.75).rect(x, y, widths[index], height).fillAndStroke('#ffffff', '#000000');
      drawCellText(values[index] || '', x, y, widths[index], height);
      x += widths[index];
    });
    return y + height;
  };
  const drawPage = (y: number): number => {
    drawBoldCentered(title, y, TITLE_FONT, 36);
    let next = y + 36;
    next = drawBand(next, [topRow], 'top');
    next = drawBand(next, columns.map(col => col.title), 'head');
    return next;
  };

  let y = drawPage(top);
  for (const row of rows) {
    const height = Math.max(15, ...widths.map((width, index) => wrappedLines(row[index] || '', width) * 16 + 4));
    if (y + height > pdf.page.height - bottom) {
      pdf.addPage();
      y = drawPage(top);
    }
    y = drawBand(y, row, 'cell');
  }
  if (!rows.length) {
    pdf.lineWidth(0.75).rect(left, y, contentWidth, 28).fillAndStroke('#ffffff', '#000000');
    drawCellText('暂无数据', left, y, contentWidth, 28);
  }
  pdf.end();
  return done;
}

function groupThousands(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] ? `.${match[3]}` : ''}`;
}

function money2(value: unknown): string {
  return groupThousands(formatMoney(value, 2));
}

export function documentPdf(kind: U9DocumentKind, document: U9ReceivableDocument | U9ReceiptDocument): Promise<Buffer> {
  return kind === 'receipts'
    ? receiptPdf(document as U9ReceiptDocument)
    : receivablePdf(document as U9ReceivableDocument);
}

function receivablePdf(document: U9ReceivableDocument): Promise<Buffer> {
  return gridPdf('应收单列表', `${document.docNo} ${document.customer}应收单`, [
    { title: '来源单号', width: 118 },
    { title: '来源行号', width: 60 },
    { title: '料品', width: 170 },
    { title: '料号', width: 84 },
    { title: '主单位', width: 58 },
    { title: '数量', width: 72 },
    { title: '含税单价', width: 82 },
    { title: '价税合计', width: 92 },
    { title: '到期日', width: 76 },
  ], document.lines.map(line => [
    line.srcShipNo || '-',
    String(line.srcLineNum),
    line.itemName || '-',
    line.itemCode || '-',
    line.uom || '-',
    line.qty,
    line.taxPrice,
    line.taxIncludedTotal,
    line.maturity || '-',
  ]), 'A4');
}

function receiptPdf(document: U9ReceiptDocument): Promise<Buffer> {
  return gridPdf('收款单列表', `${document.docNo} ${document.customer}收款单`, [
    { title: '行号', width: 56 },
    { title: '结算方式', width: 100 },
    { title: '流水号', width: 380 },
    { title: '金额(元)', width: 96 },
    { title: '银行账号', width: 150 },
  ], document.lines.map(line => [
    String(line.lineNum),
    line.settlementMethod || '-',
    line.noteNo || '-',
    money2(line.amount),
    line.bankAccount || '-',
  ]), 'A4');
}

interface SummaryGroup {
  code: string;
  name: string;
  saleser: string;
  carry: string | null;
  months: Map<string, string | null>;
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

export function summaryPdf(from: string, to: string, rows: Record<string, unknown>[]): Promise<Buffer> {
  const months = summaryMonths(from, to);
  const groups = new Map<string, SummaryGroup>();
  for (const row of rows) {
    const code = String(row.CustomerCode ?? '');
    if (!code) continue;
    let group = groups.get(code);
    if (!group) {
      group = { code, name: String(row.CustomerName || '-'), saleser: String(row.Saleser || '-'), carry: null, months: new Map() };
      groups.set(code, group);
    }
    const display = String(row.DisplayName || '');
    // 空月为 null；镜像误存的 '-' 与空串同等视为无金额
    const raw = row.UnRecMoney;
    const value =
      raw === null || raw === undefined || raw === '' || raw === '-'
        ? null
        : String(raw);
    if (display === '承上' || Number(row.RowNum) === 0) group.carry = value;
    else if (/^\d{4}-\d{2}$/.test(display)) group.months.set(display, value);
  }

  const lines = [...groups.values()].map(group => {
    const amounts = [group.carry, ...months.map(month => group.months.get(month))].filter(
      (value): value is string => typeof value === 'string' && !!value && value !== '-'
    );
    return [
      group.name,
      group.code,
      group.saleser,
      group.carry === null ? '' : money2(group.carry),
      ...months.map(month => (group.months.get(month) === null || group.months.get(month) === undefined ? '' : money2(group.months.get(month)))),
      amounts.length ? money2(sumLines(amounts)) : '',
    ];
  });
  // 金额列宽度保证「99,999.00」与「2025-01」单行显示；月数多时加宽页面而非压窄列
  const moneyWidth = 78;
  const columns: GridColumn[] = [
    { title: '客户', width: 168 },
    { title: '客户代码', width: 56 },
    { title: '业务员', width: 56 },
    { title: '承上', width: moneyWidth },
    ...months.map((month) => ({ title: month, width: moneyWidth })),
    { title: '合计', width: moneyWidth },
  ];
  return gridPdf('应收款汇总表', `${from} 到 ${to}`, columns, lines, 'A3', 'minWidth');
}

function sumLines(values: string[]): string {
  const scale = 1000000000n;
  let sum = 0n;
  for (const value of values) {
    const match = /^(-?)(\d+)(?:\.(\d{0,9}))?$/.exec(value || '');
    if (!match) throw new Error('U9 金额格式无效');
    sum += BigInt(match[1] ? -match[2] : match[2]) * scale + BigInt((match[3] || '').padEnd(9, '0'));
  }
  const negative = sum < 0n;
  const absolute = (negative ? -sum : sum).toString();
  const padded = absolute.padStart(10, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -9)}.${padded.slice(-9)}`;
}
