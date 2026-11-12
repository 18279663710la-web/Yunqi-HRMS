export interface U9Operator {
  id: string;
  code: string;
  name: string;
  orgId: string;
  orgName: string;
}

export interface U9Customer {
  id: string;
  name: string;
}

export type U9DocumentKind = 'receivables' | 'receipts';
export interface U9Document { id: string; docNo: string; [key: string]: unknown }

export interface U9ReceivableQuery {
  period?: string;
  customerId?: string;
  customerKeyword?: string;
}

/** 应收单列表与详情共用的本人明细行，金额已按币种精度格式化。 */
export interface U9ReceivableLine {
  lineNum: number;
  srcShipNo: string;
  srcLineNum: number;
  itemName: string;
  itemCode: string;
  uom: string;
  qty: string;
  nonTaxPrice: string;
  taxPrice: string;
  nonTaxAmount: string;
  taxAmount: string;
  taxIncludedTotal: string;
  totalAmount: string;
  totalBalance: string;
  bizOrg: string;
  maturity: string | null;
  lineStatus: string;
}

/** 按单号聚合的应收单；lines 只包含当前业务员归属的出货明细。 */
export interface U9ReceivableDocument {
  id: string;
  docNo: string;
  customer: string;
  businessDate: string;
  postPeriod: string;
  srcOrg: string;
  invoiceDate: string | null;
  invoiceNum: string;
  lines: U9ReceivableLine[];
}

/** 回款通知明细，字段与 U9“收款单审核发送”邮件模板一致。 */
export interface U9ReceiptNotificationLine {
  lineNum: number;
  settlementMethod: string;
  noteNo: string;
  amount: string;
  bankAccount: string;
}

/** 回款通知候选单据；transactorId 用于映射到本系统员工。 */
export interface U9ReceiptNotification {
  id: string;
  docNo: string;
  customerName: string;
  businessDate: string;
  totalAmount: string;
  orgName: string;
  transactorId: string;
  lines: U9ReceiptNotificationLine[];
}

/** 收款单 PDF 的整单结算明细；访问范围仍由业务员关联校验。 */
export interface U9ReceiptDocumentLine {
  lineNum: number;
  settlementMethod: string;
  noteNo: string;
  amount: string;
  bankAccount: string;
}

export interface U9ReceiptDocument extends U9Document {
  customer: string;
  businessDate: string;
  totalAmount: string;
  status: unknown;
  lines: U9ReceiptDocumentLine[];
}

export interface U9ReceiptQuery {
  period?: string;
  customerId?: string;
  customerKeyword?: string;
}

export interface U9Gateway {
  searchOperators(keyword: string): Promise<U9Operator[]>;
  getOperator(id: string): Promise<U9Operator | null>;
  listDocuments(kind: U9DocumentKind, operatorId: string, page?: number, query?: U9ReceiptQuery): Promise<U9Document[]>;
  getDocument(kind: U9DocumentKind, operatorId: string, id: string): Promise<U9Document | null>;
  getReceiptDocument(operatorId: string, id: string): Promise<U9ReceiptDocument | null>;
  listReceivableDocuments(operatorId: string, page: number | undefined, query: U9ReceivableQuery): Promise<U9ReceivableDocument[]>;
  getReceivableDocument(operatorId: string, id: string): Promise<U9ReceivableDocument | null>;
  listReceivableCustomers(operatorId: string, period?: string): Promise<U9Customer[]>;
  listReceiptCustomers(operatorId: string, period?: string): Promise<U9Customer[]>;
  listReceiptsForNotification(sinceDate: string, orgCode: string): Promise<U9ReceiptNotification[]>;
  getSummary?(operatorId: string, fromPeriod: string, toPeriod: string): Promise<Record<string, unknown>[]>;
}
