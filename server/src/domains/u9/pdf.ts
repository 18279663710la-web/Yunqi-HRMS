import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { U9Document, U9DocumentKind } from './types';
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

export function documentPdf(kind: U9DocumentKind, document: U9Document): Promise<Buffer> {
  const lines = Array.isArray(document.lines) ? document.lines as Array<{ shipNo?: string; amount?: string }> : [];
  return tablePdf(kind === 'receivables' ? '应收单' : '收款单', [
    `单号：${document.docNo}    日期：${document.date || '-'}`,
    `客户：${document.customer || '-'}    币种：${document.currency || '-'}    归属合计：${formatMoney(sumAmounts(lines.map(line => line.amount)), document.currencyPrecision ?? 2)}`,
  ], [{ title: '出货单号', width: 300 }, { title: '归属金额', width: 215, align: 'right' }],
  lines.map(line => [line.shipNo || '-', formatMoney(line.amount, document.currencyPrecision ?? 2)]));
}

export function summaryPdf(from: string, to: string, rows: Record<string, unknown>[]): Promise<Buffer> {
  return tablePdf('应收款汇总表', [`会计期间：${from} 至 ${to}`, `业务员：${rows[0]?.Saleser || '-'}`], [
    { title: '客户编码', width: 65 }, { title: '客户名称', width: 130 }, { title: '账期', width: 65 }, { title: '期间', width: 60 },
    { title: '应收金额', width: 125, align: 'right' }, { title: '币种', width: 70 },
  ], rows.map(row => [String(row.CustomerCode || '-'), String(row.CustomerName || '-'), String(row.ARTerm || '-'), String(row.DisplayName || '-'), formatMoney(row.UnRecMoney, row.MoneyPrecision), String(row.CurrencyName || '-')]));
}
