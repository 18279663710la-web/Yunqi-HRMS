/** 在字符串上四舍五入，避免通过 JavaScript 浮点数损失金额精度。 */
export function formatMoney(value: unknown, precision: unknown): string {
  if (value === null || value === undefined) return '-';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return String(value);
  const digits = Math.max(0, Math.min(9, precision !== null && precision !== undefined && Number.isInteger(Number(precision)) ? Number(precision) : 2));
  const fraction = (match[3] || '').padEnd(digits + 1, '0');
  const scale = 10n ** BigInt(digits);
  let amount = BigInt(match[2]) * scale + BigInt(fraction.slice(0, digits) || '0');
  if (Number(fraction[digits]) >= 5) amount += 1n;
  const prefix = match[1] && amount !== 0n ? '-' : '';
  return prefix + String(amount / scale) + (digits ? `.${String(amount % scale).padStart(digits, '0')}` : '');
}
