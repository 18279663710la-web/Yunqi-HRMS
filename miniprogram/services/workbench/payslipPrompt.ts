export interface PayslipReminder { id: number; revision: number; read: boolean }
export const payslipReminderKey = (item: PayslipReminder): string => `${item.id}:${item.revision}`;
export function nextUnreadPayslip<T extends PayslipReminder>(items: T[], shown: Set<string>): T | undefined {
  return items.find(item => !item.read && !shown.has(payslipReminderKey(item)));
}
