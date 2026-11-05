/** 数电票用 20 位号码；传统发票用 10/12 位代码与 8 位号码。 */
export function invoiceKey(invoice: { invoiceCode?: string; invoiceNumber?: string } | null | undefined): string {
  const clean = (value: unknown): string => String(value ?? '').replace(/[\s-]/g, '');
  const number = clean(invoice?.invoiceNumber);
  const code = clean(invoice?.invoiceCode);
  if (/^\d{20}$/.test(number)) return number;
  if (/^\d{8}$/.test(number) && /^(?:\d{10}|\d{12})$/.test(code)) return `${code}-${number}`;
  return '';
}

export function round2(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function toNumber(raw: unknown): number {
  const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

export function randomDigits(len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}
