export interface U9Operator {
  id: string;
  code: string;
  name: string;
  orgId: string;
  orgName: string;
}

export type U9DocumentKind = 'receivables' | 'receipts';
export interface U9Document { id: string; docNo: string; [key: string]: unknown }

export interface U9Gateway {
  searchOperators(keyword: string): Promise<U9Operator[]>;
  getOperator(id: string): Promise<U9Operator | null>;
  listDocuments(kind: U9DocumentKind, operatorId: string, page?: number): Promise<U9Document[]>;
  getDocument(kind: U9DocumentKind, operatorId: string, id: string): Promise<U9Document | null>;
  getSummary?(operatorId: string, fromPeriod: string, toPeriod: string): Promise<Record<string, unknown>[]>;
}
