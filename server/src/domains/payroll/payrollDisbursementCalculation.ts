export type DisbursementCategory = 'income' | 'deduction' | 'info';

/** 按分计算发放实发，不引用批次历史独立扣除。 */
export function calculateDisbursementNet(gross: number, fields: ReadonlyArray<{ category: DisbursementCategory; value: number }>): number {
  let cents = Math.round(Number(gross) * 100);
  for (const field of fields) {
    const value = Math.round(Number(field.value) * 100);
    if (field.category === 'income') cents += value;
    if (field.category === 'deduction') cents -= value;
  }
  return cents / 100;
}
