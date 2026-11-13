import { queryOne, queryRows } from '../../shared/db/pool';
import { config } from '../../config';
import { withU9Cache } from './queryCache';
import { formatMoney } from './money';
import type {
  U9Customer,
  U9Document,
  U9DocumentKind,
  U9Gateway,
  U9Operator,
  U9ReceiptDocument,
  U9ReceiptNotification,
  U9ReceivableDocument,
  U9ReceivableLine,
  U9ReceivableQuery,
} from './types';

function periodRange(period: string): { start: string; end: string } {
  const [year, month] = period.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return {
    start: `${period}-01`,
    end: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`,
  };
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

async function loadArLines(docIds: string[], operatorId: string): Promise<Map<string, U9ReceivableLine[]>> {
  if (!docIds.length) return new Map();
  const placeholders = docIds.map(() => '?').join(',');
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT doc_id docId, line_num lineNum, src_ship_no srcShipNo, src_line_num srcLineNum,
      item_name itemName, item_code itemCode, uom, qty, non_tax_price nonTaxPrice, tax_price taxPrice,
      non_tax_amount nonTaxAmount, tax_amount taxAmount, tax_included_total taxIncludedTotal,
      total_amount totalAmount, total_balance totalBalance, biz_org bizOrg,
      DATE_FORMAT(maturity,'%Y-%m-%d') maturity, line_status lineStatus
     FROM u9_mirror_ar_lines
     WHERE doc_id IN (${placeholders}) AND seller_operator_id=?
     ORDER BY doc_id, line_num`,
    [...docIds, operatorId]
  );
  const grouped = new Map<string, U9ReceivableLine[]>();
  for (const row of rows) {
    const docId = String(row.docId);
    const line: U9ReceivableLine = {
      lineNum: Number(row.lineNum),
      srcShipNo: String(row.srcShipNo || '-'),
      srcLineNum: Number(row.srcLineNum),
      itemName: String(row.itemName || '-'),
      itemCode: String(row.itemCode || '-'),
      uom: String(row.uom || '-'),
      qty: String(row.qty),
      nonTaxPrice: String(row.nonTaxPrice),
      taxPrice: String(row.taxPrice),
      nonTaxAmount: String(row.nonTaxAmount),
      taxAmount: String(row.taxAmount),
      taxIncludedTotal: String(row.taxIncludedTotal),
      totalAmount: String(row.totalAmount),
      totalBalance: String(row.totalBalance),
      bizOrg: String(row.bizOrg || '-'),
      maturity: row.maturity ? String(row.maturity) : null,
      lineStatus: String(row.lineStatus || ''),
    };
    const list = grouped.get(docId);
    if (list) list.push(line);
    else grouped.set(docId, [line]);
  }
  return grouped;
}

export const mirrorU9: U9Gateway = {
  async searchOperators(keyword) {
    return withU9Cache(`ops:${keyword}`, async () => {
      if (!keyword) {
        return queryRows<U9Operator>(
          `SELECT id, code, name, org_id orgId, org_name orgName FROM u9_mirror_operators ORDER BY name, code LIMIT 100`
        );
      }
      const like = likePattern(keyword);
      return queryRows<U9Operator>(
        `SELECT id, code, name, org_id orgId, org_name orgName FROM u9_mirror_operators
         WHERE code LIKE ? OR name LIKE ? ORDER BY name, code LIMIT 100`,
        [like, like]
      );
    });
  },

  async getOperator(id) {
    return withU9Cache(`op:${id}`, async () =>
      queryOne<U9Operator>(
        `SELECT id, code, name, org_id orgId, org_name orgName FROM u9_mirror_operators WHERE id=?`,
        [id]
      )
    );
  },

  async listDocuments(kind, operatorId, page = 1, query) {
    if (!query?.period && !query?.customerId && !query?.customerKeyword) return [];
    return withU9Cache(
      `docs:${kind}:${operatorId}:${page}:${JSON.stringify(query)}`,
      async () => {
        if (kind === 'receivables') {
          const docs = await mirrorU9.listReceivableDocuments(operatorId, page, query || {});
          return docs.map((d) => {
            const amount = d.lines.reduce((sum, line) => sum + Number(line.taxIncludedTotal || 0), 0);
            return {
              id: d.id,
              docNo: d.docNo,
              date: d.businessDate,
              customer: d.customer,
              amount: formatMoney(amount, 2),
              status: 2,
            } as U9Document;
          });
        }
        const offset = (page - 1) * 50;
        const conditions = ['s.seller_operator_id=?'];
        const params: unknown[] = [operatorId];
        if (query?.period) {
          conditions.push('h.post_period=?', 'h.business_date >= ?', 'h.business_date < ?');
          const { start, end } = periodRange(query.period);
          params.push(query.period, start, end);
        }
        if (query?.customerId) {
          conditions.push('h.customer_id=?');
          params.push(query.customerId);
        } else if (query?.customerKeyword) {
          conditions.push("h.customer_name LIKE ? ESCAPE '\\\\'");
          params.push(likePattern(query.customerKeyword));
        }
        params.push(offset);
        const rows = await queryRows<Record<string, unknown>>(
          `SELECT h.id, h.doc_no docNo, DATE_FORMAT(h.business_date,'%Y-%m-%d') date,
            h.customer_name customer, h.currency_name currency, h.currency_precision currencyPrecision,
            s.own_amount amount, h.doc_status status
           FROM u9_mirror_rec_heads h
           INNER JOIN u9_mirror_rec_sellers s ON s.doc_id=h.id
           WHERE ${conditions.join(' AND ')}
           ORDER BY h.business_date DESC, h.id DESC
           LIMIT 50 OFFSET ?`,
          params
        );
        return rows.map((row) => ({
          id: String(row.id),
          docNo: String(row.docNo),
          date: row.date,
          customer: row.customer,
          currency: row.currency,
          amount: formatMoney(row.amount, row.currencyPrecision),
          status: row.status,
        }));
      }
    );
  },

  async getDocument(kind, operatorId, id) {
    if (kind === 'receivables') {
      const doc = await mirrorU9.getReceivableDocument(operatorId, id);
      if (!doc) return null;
      return {
        id: doc.id,
        docNo: doc.docNo,
        date: doc.businessDate,
        customer: doc.customer,
        status: 2,
        lines: doc.lines.map((l) => ({ shipNo: l.srcShipNo, amount: l.taxIncludedTotal })),
      };
    }
    const receipt = await mirrorU9.getReceiptDocument(operatorId, id);
    return receipt;
  },

  async getReceiptDocument(operatorId, id) {
    return withU9Cache(`recdoc:${operatorId}:${id}`, async () => {
      const head = await queryOne<Record<string, unknown>>(
        `SELECT h.id, h.doc_no docNo, h.customer_name customer,
          DATE_FORMAT(h.business_date,'%Y-%m-%d %H:%i:%s') businessDate,
          h.total_amount totalAmount, h.doc_status status
         FROM u9_mirror_rec_heads h
         INNER JOIN u9_mirror_rec_sellers s ON s.doc_id=h.id AND s.seller_operator_id=?
         WHERE h.id=?`,
        [operatorId, id]
      );
      if (!head) return null;
      const lines = await queryRows<Record<string, unknown>>(
        `SELECT line_num lineNum, settlement_method settlementMethod, note_no noteNo,
          amount, bank_account bankAccount
         FROM u9_mirror_rec_lines WHERE doc_id=? ORDER BY line_num`,
        [id]
      );
      return {
        id: String(head.id),
        docNo: String(head.docNo || ''),
        customer: String(head.customer || '-'),
        businessDate: String(head.businessDate || ''),
        totalAmount: formatMoney(head.totalAmount, 2),
        status: head.status,
        lines: lines.map((row) => ({
          lineNum: Number(row.lineNum),
          settlementMethod: String(row.settlementMethod || '-'),
          noteNo: String(row.noteNo || '-'),
          amount: formatMoney(row.amount, 2),
          bankAccount: String(row.bankAccount || '-'),
        })),
      } as U9ReceiptDocument;
    });
  },

  async listReceivableDocuments(operatorId, page = 1, query: U9ReceivableQuery) {
    if (!query.period && !query.customerId && !query.customerKeyword) return [];
    return withU9Cache(
      `arlist:${operatorId}:${page}:${JSON.stringify(query)}`,
      async () => {
        const conditions = [
          'EXISTS (SELECT 1 FROM u9_mirror_ar_lines l WHERE l.doc_id=h.id AND l.seller_operator_id=?)',
        ];
        const params: unknown[] = [operatorId];
        if (query.period) {
          const { start, end } = periodRange(query.period);
          conditions.push('h.business_date >= ?', 'h.business_date < ?', 'h.post_period=?');
          params.push(start, end, query.period);
        }
        if (query.customerId) {
          conditions.push('h.customer_id=?');
          params.push(query.customerId);
        } else if (query.customerKeyword) {
          conditions.push("h.customer_name LIKE ? ESCAPE '\\\\'");
          params.push(likePattern(query.customerKeyword));
        }
        const offset = (page - 1) * 50;
        params.push(offset);
        const heads = await queryRows<Record<string, unknown>>(
          `SELECT h.id, h.doc_no docNo, DATE_FORMAT(h.business_date,'%Y-%m-%d') businessDate,
            h.post_period postPeriod, h.src_org srcOrg,
            DATE_FORMAT(h.invoice_date,'%Y-%m-%d') invoiceDate, h.invoice_num invoiceNum,
            h.customer_name customer
           FROM u9_mirror_ar_heads h
           WHERE ${conditions.join(' AND ')}
           ORDER BY h.business_date DESC, h.id DESC
           LIMIT 50 OFFSET ?`,
          params
        );
        if (!heads.length) return [];
        const ids = heads.map((h) => String(h.id));
        const grouped = await loadArLines(ids, operatorId);
        return heads
          .map((row) => {
            const lines = grouped.get(String(row.id)) || [];
            if (!lines.length) return null;
            return {
              id: String(row.id),
              docNo: String(row.docNo || ''),
              customer: String(row.customer || '-'),
              businessDate: String(row.businessDate || ''),
              postPeriod: String(row.postPeriod || ''),
              srcOrg: String(row.srcOrg || '-'),
              invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
              invoiceNum: String(row.invoiceNum || ''),
              lines,
            } as U9ReceivableDocument;
          })
          .filter((d): d is U9ReceivableDocument => !!d);
      }
    );
  },

  async getReceivableDocument(operatorId, id) {
    return withU9Cache(`ardoc:${operatorId}:${id}`, async () => {
      const head = await queryOne<Record<string, unknown>>(
        `SELECT h.id, h.doc_no docNo, DATE_FORMAT(h.business_date,'%Y-%m-%d') businessDate,
          h.post_period postPeriod, h.src_org srcOrg,
          DATE_FORMAT(h.invoice_date,'%Y-%m-%d') invoiceDate, h.invoice_num invoiceNum,
          h.customer_name customer
         FROM u9_mirror_ar_heads h
         WHERE h.id=? AND EXISTS (
           SELECT 1 FROM u9_mirror_ar_lines l WHERE l.doc_id=h.id AND l.seller_operator_id=?
         )`,
        [id, operatorId]
      );
      if (!head) return null;
      const grouped = await loadArLines([id], operatorId);
      const lines = grouped.get(id) || [];
      if (!lines.length) return null;
      return {
        id: String(head.id),
        docNo: String(head.docNo || ''),
        customer: String(head.customer || '-'),
        businessDate: String(head.businessDate || ''),
        postPeriod: String(head.postPeriod || ''),
        srcOrg: String(head.srcOrg || '-'),
        invoiceDate: head.invoiceDate ? String(head.invoiceDate) : null,
        invoiceNum: String(head.invoiceNum || ''),
        lines,
      };
    });
  },

  async listReceivableCustomers(operatorId, period) {
    return withU9Cache(`arcust:${operatorId}:${period || ''}`, async () => {
      const conditions = ['l.seller_operator_id=?', "h.customer_id<>''"];
      const params: unknown[] = [operatorId];
      if (period) {
        conditions.push('h.post_period=?');
        params.push(period);
      }
      return queryRows<U9Customer>(
        `SELECT DISTINCT h.customer_id id, h.customer_name name
         FROM u9_mirror_ar_heads h
         INNER JOIN u9_mirror_ar_lines l ON l.doc_id=h.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY h.customer_name`,
        params
      );
    });
  },

  async listReceiptCustomers(operatorId, period) {
    return withU9Cache(`reccust:${operatorId}:${period || ''}`, async () => {
      const conditions = ['s.seller_operator_id=?', "h.customer_id<>''"];
      const params: unknown[] = [operatorId];
      if (period) {
        conditions.push('h.post_period=?');
        params.push(period);
      }
      return queryRows<U9Customer>(
        `SELECT DISTINCT h.customer_id id, h.customer_name name
         FROM u9_mirror_rec_heads h
         INNER JOIN u9_mirror_rec_sellers s ON s.doc_id=h.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY h.customer_name`,
        params
      );
    });
  },

  async listReceiptsForNotification(sinceDate, orgCode) {
    const heads = await queryRows<Record<string, unknown>>(
      `SELECT id, doc_no docNo, customer_name customerName,
        DATE_FORMAT(business_date,'%Y-%m-%d %H:%i:%s') businessDate,
        total_amount totalAmount, org_name orgName, transactor_id transactorId
       FROM u9_mirror_rec_heads
       WHERE org_code=? AND doc_status>=2 AND business_date >= ?
         AND transactor_id IS NOT NULL AND transactor_id<>'' AND transactor_id<>'0'
       ORDER BY id`,
      [orgCode, sinceDate]
    );
    if (!heads.length) return [];
    const ids = heads.map((h) => String(h.id));
    const placeholders = ids.map(() => '?').join(',');
    const lines = await queryRows<Record<string, unknown>>(
      `SELECT doc_id docId, line_num lineNum, settlement_method settlementMethod,
        note_no noteNo, amount, bank_account bankAccount
       FROM u9_mirror_rec_lines WHERE doc_id IN (${placeholders}) ORDER BY doc_id, line_num`,
      ids
    );
    const byDoc = new Map<string, U9ReceiptNotification>();
    for (const head of heads) {
      const id = String(head.id);
      byDoc.set(id, {
        id,
        docNo: String(head.docNo || ''),
        customerName: String(head.customerName || ''),
        businessDate: String(head.businessDate || ''),
        totalAmount: formatMoney(head.totalAmount, 2),
        orgName: String(head.orgName || ''),
        transactorId: String(head.transactorId || ''),
        lines: [],
      });
    }
    for (const line of lines) {
      const doc = byDoc.get(String(line.docId));
      if (!doc) continue;
      doc.lines.push({
        lineNum: Number(line.lineNum),
        settlementMethod: String(line.settlementMethod || ''),
        noteNo: String(line.noteNo || ''),
        amount: formatMoney(line.amount, 2),
        bankAccount: String(line.bankAccount || ''),
      });
    }
    return [...byDoc.values()];
  },

  async getSummary(operatorId, fromPeriod, toPeriod) {
    return withU9Cache(`sum:${operatorId}:${fromPeriod}:${toPeriod}`, async () => {
      const rows = await queryRows<Record<string, unknown>>(
        `SELECT customer_code CustomerCode, customer_name CustomerName, ar_term ARTerm,
          saleser Saleser, row_num RowNum, display_name DisplayName,
          un_rec_money UnRecMoney, currency_name CurrencyName, money_precision MoneyPrecision
         FROM u9_mirror_summary_rows
         WHERE operator_id=? AND from_period=? AND to_period=?
         ORDER BY customer_code, row_num`,
        [operatorId, fromPeriod, toPeriod]
      );
      return rows;
    });
  },
};

export function mirrorSyncMeta() {
  return {
    querySource: config.u9Mirror.querySource,
  };
}
