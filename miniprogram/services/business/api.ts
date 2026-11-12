import { get, post } from '../../utils/request';

export interface ReceiptNotificationSummary {
  id: number;
  docNo: string;
  customerName: string;
  businessDate: string;
  totalAmount: string;
  lineCount: number;
  isRead: boolean;
  createdAt: string;
}

export interface ReceivableCustomer {
  id: string;
  name: string;
  /** 客户名称的拼音首字母串（如 dongguan → dg），由服务端生成。 */
  initials: string;
  /** 客户名称的全拼串（如 东莞 → dongguan），由服务端生成。 */
  fullPinyin: string;
}

export interface ReceiptNotificationLine {
  lineNum: number;
  settlementMethod: string;
  noteNo: string;
  amount: string;
  bankAccount: string;
}

export interface ReceiptNotificationDetail extends ReceiptNotificationSummary {
  orgName: string;
  lines: ReceiptNotificationLine[];
}

export function getReceiptNotifications(page = 1): Promise<ReceiptNotificationSummary[]> {
  return get<ReceiptNotificationSummary[]>('/business/receipt-notifications', { page });
}

/** 拉取本人客户池（可选按记账期间过滤）；keyword 留空返回全量池，输入过滤在小程序本地完成。 */
export function getReceivableCustomers(period?: string): Promise<ReceivableCustomer[]> {
  return get<ReceivableCustomer[]>('/business/receivable-customers', {
    ...(period ? { period } : {}),
  });
}

export function getReceiptCustomers(period?: string): Promise<ReceivableCustomer[]> {
  return get<ReceivableCustomer[]>('/business/receipt-customers', {
    ...(period ? { period } : {}),
  });
}

export function getReceiptNotificationUnreadCount(): Promise<{ count: number }> {
  return get<{ count: number }>('/business/receipt-notifications/unread-count');
}

export function getReceiptNotification(id: number): Promise<ReceiptNotificationDetail> {
  return get<ReceiptNotificationDetail>(`/business/receipt-notifications/${id}`);
}

export function markReceiptNotificationRead(id: number): Promise<void> {
  return post<void>(`/business/receipt-notifications/${id}/read`, {});
}
