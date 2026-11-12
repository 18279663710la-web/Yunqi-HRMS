import type {
  U9Customer,
  U9Document,
  U9DocumentKind,
  U9Gateway,
  U9Operator,
  U9ReceiptDocument,
  U9ReceiptDocumentLine,
  U9ReceiptNotification,
  U9ReceiptNotificationLine,
  U9ReceivableDocument,
  U9ReceivableLine,
  U9ReceivableQuery,
} from './types';
import { HttpError } from '../../shared/utils/errors';
import { formatMoney } from './money';

// ODBC 连接仅在 U9 功能被访问时建立，不影响原有业务启动。
function connectionString(): string {
  const value = (name: string, fallback: string) => `{${(process.env[name] || fallback).replace(/}/g, '}}')}}`;
  return `Driver=${value('U9_SQL_DRIVER', 'ODBC Driver 17 for SQL Server')};Server=${value('U9_SQL_SERVER', '.')};Database=${value('U9_SQL_DATABASE', 'U9数据库')};Trusted_Connection=Yes;TrustServerCertificate=Yes;ApplicationIntent=ReadOnly;`;
}

async function sql<T>(statement: string, params: string[]): Promise<T[]> {
  try {
    const driver = await import('msnodesqlv8');
    return await new Promise<T[]>((resolve, reject) => {
      driver.query(connectionString(), statement, params, (err, rows) => err ? reject(err) : resolve(rows as T[]));
    });
  } catch (error) {
    console.error('[U9] 数据库查询失败', error instanceof Error ? error.message : '未知错误');
    throw new HttpError(503, 503, 'U9 数据库暂不可用，请联系管理员');
  }
}

const operatorSelect = `SELECT CONVERT(varchar(20), o.ID) id, o.Code code, t.Name name,
  CONVERT(varchar(20), o.Org) orgId, COALESCE(ot.Name, '') orgName
  FROM CBO_Operators o LEFT JOIN CBO_Operators_Trl t ON t.ID=o.ID AND t.SysMLFlag='zh-CN'
  LEFT JOIN Base_Organization_Trl ot ON ot.ID=o.Org AND ot.SysMLFlag='zh-CN'`;

const arFrom = `FROM AR_ARBillLine a JOIN AR_ARBillHead h ON h.ID=a.ARBillHead
  JOIN SM_ShipLine sl ON sl.ID=a.SrcDataID AND sl.Ship=a.SrcBillID
  JOIN SM_Ship s ON s.ID=sl.Ship
  LEFT JOIN CBO_Customer_Trl c ON c.ID=h.AccrueCust_Customer AND c.SysMLFlag='zh-CN'
  LEFT JOIN Base_Currency currency ON currency.ID=h.AC
  LEFT JOIN Base_Currency_Trl cur ON cur.ID=h.AC AND cur.SysMLFlag='zh-CN'
  LEFT JOIN Base_SOBAccountingPeriod per ON per.ID=h.PostPeriod
  WHERE sl.Seller=CONVERT(bigint,?) AND h.Cancel_Canceled=0 AND h.DocStatus>1 AND s.Cancel_Canceled=0`;
const receiptFrom = `FROM AR_ARApplyLine ap
  JOIN AR_ARBillLine a ON a.ID=ap.DRBillLineTag AND a.ARBillHead=ap.DRBillTag
  JOIN SM_ShipLine sl ON sl.ID=a.SrcDataID AND sl.Ship=a.SrcBillID
  JOIN SM_Ship s ON s.ID=sl.Ship
  JOIN AR_RecBillUseLine u ON u.ID=ap.CRDataTag AND u.RecBillHead=ap.CRBillTag
  JOIN AR_RecBillHead h ON h.ID=u.RecBillHead
  LEFT JOIN CBO_Customer_Trl c ON c.ID=h.Cust_Customer AND c.SysMLFlag='zh-CN'
  LEFT JOIN Base_Currency currency ON currency.ID=h.AC
  LEFT JOIN Base_Currency_Trl cur ON cur.ID=h.AC AND cur.SysMLFlag='zh-CN'
  LEFT JOIN Base_SOBAccountingPeriod per ON per.ID=h.PostPeriod
  WHERE sl.Seller=CONVERT(bigint,?) AND h.Cancel_Canceled=0 AND h.DocStatus>1 AND s.Cancel_Canceled=0`;

function source(kind: U9DocumentKind): { from: string; amount: string; date: string } {
  return kind === 'receivables'
    ? { from: arFrom, amount: 'a.AROCMoney_TotalMoney', date: 'h.BusinessDate' }
    : { from: receiptFrom, amount: 'ap.CRApplyOCMoney_TotalMoney', date: 'h.BusinessDate' };
}

const receivableHeadJoins = `FROM AR_ARBillLine a
  JOIN AR_ARBillHead h ON h.ID=a.ARBillHead
  JOIN SM_ShipLine sl ON sl.ID=a.SrcDataID AND sl.Ship=a.SrcBillID
  JOIN SM_Ship s ON s.ID=sl.Ship
  LEFT JOIN CBO_Customer_Trl c ON c.ID=h.AccrueCust_Customer AND c.SysMLFlag='zh-CN'
  LEFT JOIN Base_SOBAccountingPeriod per ON per.ID=h.PostPeriod
  LEFT JOIN Base_Organization_Trl org ON org.ID=h.SrcOrg AND org.SysMLFlag='zh-CN'`;

const receivableHeadWhere = `sl.Seller=CONVERT(bigint,?) AND h.Cancel_Canceled=0 AND h.DocStatus>1 AND s.Cancel_Canceled=0`;

const receivableHeadSelect = `SELECT CONVERT(varchar(20),h.ID) id,
  MAX(h.DocNo) docNo,
  CONVERT(varchar(10),MAX(h.BusinessDate),23) businessDate,
  MAX(per.DisplayName) postPeriod,
  MAX(org.Name) srcOrg,
  CONVERT(varchar(10),MAX(h.InvoiceDate),23) invoiceDate,
  MAX(h.InvoiceNum) invoiceNum,
  MAX(c.Name) customer`;

const receivableDetailSql = `${receivableHeadSelect} ${receivableHeadJoins}
  WHERE ${receivableHeadWhere} AND h.ID=CONVERT(bigint,?) GROUP BY h.ID`;

const receivableCustomerJoins = `FROM AR_ARBillLine a
  JOIN AR_ARBillHead h ON h.ID=a.ARBillHead
  JOIN SM_ShipLine sl ON sl.ID=a.SrcDataID AND sl.Ship=a.SrcBillID
  JOIN SM_Ship s ON s.ID=sl.Ship
  JOIN CBO_Customer_Trl c ON c.ID=h.AccrueCust_Customer AND c.SysMLFlag='zh-CN'
  LEFT JOIN Base_SOBAccountingPeriod per ON per.ID=h.PostPeriod`;

const receivableCustomerWhere = `sl.Seller=CONVERT(bigint,?) AND h.Cancel_Canceled=0 AND h.DocStatus>1 AND s.Cancel_Canceled=0`;

function periodRange(period: string): { start: string; end: string } {
  const [year, month] = period.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return {
    start: `${period}-01`,
    end: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`,
  };
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_[]/g, '\\$&')}%`;
}

function receivableLineSql(count: number): string {
  const ids = Array.from({ length: count }, () => '?').join(',');
  return `SELECT CONVERT(varchar(20),h.ID) docId,
    a.LineNum lineNum, s.DocNo srcShipNo, sl.DocLineNo srcLineNo,
    a.Item_ItemName itemName, a.Item_ItemCode itemCode,
    u.Name uom, CONVERT(varchar(50),a.PUAmount) qty,
    CONVERT(varchar(50),a.NonTaxPrice) nonTaxPrice, CONVERT(varchar(50),a.TaxPrice) taxPrice,
    CONVERT(varchar(60),a.AROCMoney_NonTax) nonTaxAmount, CONVERT(varchar(60),a.AROCMoney_Tax) taxAmount,
    CONVERT(varchar(60),a.AROCMoney_TotalMoney) taxIncludedTotal,
    CONVERT(varchar(60),a.ARFCMoney_TotalMoney) totalAmount,
    CONVERT(varchar(60),a.ARFCMoneyBalance_TotalMoney) totalBalance,
    biz.Name bizOrg, CONVERT(varchar(10),a.Maturity,23) maturity,
    a.RedFlushStatus, a.IsRedFlush, currency.MoneyRound_Precision currencyPrecision
    FROM AR_ARBillLine a
    JOIN AR_ARBillHead h ON h.ID=a.ARBillHead
    JOIN SM_ShipLine sl ON sl.ID=a.SrcDataID AND sl.Ship=a.SrcBillID
    JOIN SM_Ship s ON s.ID=sl.Ship
    LEFT JOIN Base_Currency currency ON currency.ID=h.AC
    LEFT JOIN Base_UOM_Trl u ON u.ID=a.PUom AND u.SysMLFlag='zh-CN'
    LEFT JOIN Base_Organization_Trl biz ON biz.ID=a.BizOrg AND biz.SysMLFlag='zh-CN'
    WHERE h.ID IN (${ids}) AND sl.Seller=CONVERT(bigint,?) AND h.Cancel_Canceled=0 AND h.DocStatus>1 AND s.Cancel_Canceled=0
    ORDER BY h.ID,a.LineNum`;
}

function receivableLine(row: Record<string, unknown>): U9ReceivableLine {
  return {
    lineNum: Number(row.lineNum),
    srcShipNo: String(row.srcShipNo || '-'),
    srcLineNum: Number(row.srcLineNo),
    itemName: String(row.itemName || '-'),
    itemCode: String(row.itemCode || '-'),
    uom: String(row.uom || '-'),
    qty: formatMoney(row.qty, 4),
    nonTaxPrice: formatMoney(row.nonTaxPrice, 4),
    taxPrice: formatMoney(row.taxPrice, 4),
    nonTaxAmount: formatMoney(row.nonTaxAmount, row.currencyPrecision),
    taxAmount: formatMoney(row.taxAmount, row.currencyPrecision),
    taxIncludedTotal: formatMoney(row.taxIncludedTotal, row.currencyPrecision),
    totalAmount: formatMoney(row.totalAmount, row.currencyPrecision),
    totalBalance: formatMoney(row.totalBalance, row.currencyPrecision),
    bizOrg: String(row.bizOrg || '-'),
    maturity: row.maturity ? String(row.maturity) : null,
    lineStatus: Number(row.RedFlushStatus) === -1 && !row.IsRedFlush ? '' : '红冲',
  };
}

function receivableDocument(row: Record<string, unknown>, lines: U9ReceivableLine[]): U9ReceivableDocument {
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
  };
}

const receiptNotificationSql = `SELECT CONVERT(varchar(20),h.ID) id, h.DocNo docNo,
  COALESCE(c.Name, h.Cust_ShortName, h.Cust_Code, '') customerName,
  CONVERT(varchar(19),h.BusinessDate,120) businessDate,
  CONVERT(varchar(60),h.TotalMoney_OCMoney) totalAmount,
  COALESCE(org.Name,'') orgName,
  CONVERT(varchar(20),h.Transactor) transactorId,
  l.LineNum lineNum,
  COALESCE(sm.Name,'') settlementMethod,
  COALESCE(trl.NoteNo,'') noteNo,
  CONVERT(varchar(60),l.Money_OCMoney) amount,
  COALESCE(bank.Name, l.RecBkAccName, '') bankAccount
  FROM AR_RecBillHead h
  JOIN AR_RecBillLine l ON l.RecBillHead=h.ID
  JOIN Base_Organization o ON o.ID=h.Org AND o.Code=?
  LEFT JOIN Base_Organization_Trl org ON org.ID=h.Org AND org.SysMLFlag='zh-CN'
  LEFT JOIN CBO_Customer_Trl c ON c.ID=h.Cust_Customer AND c.SysMLFlag='zh-CN'
  LEFT JOIN CBO_SettlementMethod_Trl sm ON sm.ID=l.SettlementMethod AND sm.SysMLFlag='zh-CN'
  LEFT JOIN AR_RecBillLine_Trl trl ON trl.ID=l.ID AND trl.SysMLFlag='zh-CN'
  LEFT JOIN CBO_BankAccount b ON b.ID=l.RecBkAccount
  LEFT JOIN CBO_BankAccount_Trl bank ON bank.ID=b.ID AND bank.SysMLFlag='zh-CN'
  WHERE h.DocStatus>=2 AND h.Cancel_Canceled=0
    AND h.Transactor IS NOT NULL AND h.Transactor<>0
    AND h.BusinessDate >= CONVERT(date,?)
  ORDER BY h.ID,l.LineNum`;

function receiptNotificationLine(row: Record<string, unknown>): U9ReceiptNotificationLine {
  return {
    lineNum: Number(row.lineNum),
    settlementMethod: String(row.settlementMethod || ''),
    noteNo: String(row.noteNo || ''),
    amount: formatMoney(row.amount, 2),
    bankAccount: String(row.bankAccount || ''),
  };
}

const receiptDocumentSql = `SELECT h.DocNo docNo,
  COALESCE(c.Name,h.Cust_ShortName,h.Cust_Code,'') customer,
  CONVERT(varchar(19),h.BusinessDate,120) businessDate,
  CONVERT(varchar(60),h.TotalMoney_OCMoney) totalAmount,
  h.DocStatus status,
  l.LineNum lineNum,
  COALESCE(sm.Name,'') settlementMethod,
  COALESCE(trl.NoteNo,'') noteNo,
  CONVERT(varchar(60),l.Money_OCMoney) amount,
  COALESCE(bank.Name,l.RecBkAccName,'') bankAccount
  FROM AR_RecBillHead h
  JOIN AR_RecBillLine l ON l.RecBillHead=h.ID
  LEFT JOIN CBO_Customer_Trl c ON c.ID=h.Cust_Customer AND c.SysMLFlag='zh-CN'
  LEFT JOIN CBO_SettlementMethod_Trl sm ON sm.ID=l.SettlementMethod AND sm.SysMLFlag='zh-CN'
  LEFT JOIN AR_RecBillLine_Trl trl ON trl.ID=l.ID AND trl.SysMLFlag='zh-CN'
  LEFT JOIN CBO_BankAccount b ON b.ID=l.RecBkAccount
  LEFT JOIN CBO_BankAccount_Trl bank ON bank.ID=b.ID AND bank.SysMLFlag='zh-CN'
  WHERE h.ID=CONVERT(bigint,?) AND h.Cancel_Canceled=0 AND h.DocStatus>1
    AND EXISTS (
      SELECT 1 FROM AR_ARApplyLine ap
      JOIN AR_ARBillLine a ON a.ID=ap.DRBillLineTag AND a.ARBillHead=ap.DRBillTag
      JOIN SM_ShipLine sl ON sl.ID=a.SrcDataID AND sl.Ship=a.SrcBillID
      JOIN SM_Ship s ON s.ID=sl.Ship
      WHERE ap.CRBillTag=h.ID AND sl.Seller=CONVERT(bigint,?) AND s.Cancel_Canceled=0
    )
  ORDER BY l.LineNum`;

function receiptDocumentLine(row: Record<string, unknown>): U9ReceiptDocumentLine {
  return {
    lineNum: Number(row.lineNum),
    settlementMethod: String(row.settlementMethod || '-'),
    noteNo: String(row.noteNo || '-'),
    amount: formatMoney(row.amount, 2),
    bankAccount: String(row.bankAccount || '-'),
  };
}

export const sqlServerU9: U9Gateway = {
  async searchOperators(keyword) {
    return sql<U9Operator>(`${operatorSelect} WHERE (?='' OR o.Code LIKE ? OR t.Name LIKE ?) ORDER BY t.Name,o.Code`, [keyword, `%${keyword}%`, `%${keyword}%`]);
  },
  async getOperator(id) {
    const rows = await sql<U9Operator>(`${operatorSelect} WHERE o.ID=CONVERT(bigint,?)`, [id]);
    return rows[0] || null;
  },
  async listDocuments(kind, operatorId, page = 1, query) {
    if (!query?.period && !query?.customerId && !query?.customerKeyword) return [];
    const { from, amount, date } = source(kind);
    const extra: string[] = [];
    const params: string[] = [operatorId];
    if (query?.period) {
      const { start, end } = periodRange(query.period);
      extra.push('h.BusinessDate >= CONVERT(date,?)', 'h.BusinessDate < CONVERT(date,?)', 'per.DisplayName=?');
      params.push(start, end, query.period);
    }
    if (query?.customerId) {
      extra.push(kind === 'receipts' ? 'h.Cust_Customer=CONVERT(bigint,?)' : 'h.AccrueCust_Customer=CONVERT(bigint,?)');
      params.push(query.customerId);
    } else if (query?.customerKeyword) {
      extra.push("c.Name LIKE ? ESCAPE '\\'");
      params.push(likePattern(query.customerKeyword));
    }
    const fromSql = extra.length ? `${from} AND ${extra.join(' AND ')}` : from;
    const rows = await sql<U9Document>(`SELECT CONVERT(varchar(20),h.ID) id, h.DocNo docNo, CONVERT(varchar(10),${date},23) date,
      MAX(c.Name) customer, MAX(cur.Name) currency, MAX(currency.MoneyRound_Precision) currencyPrecision, CONVERT(varchar(50),SUM(COALESCE(${amount},0))) amount, MAX(h.DocStatus) status
      ${fromSql} GROUP BY h.ID,h.DocNo,${date} ORDER BY ${date} DESC,h.ID DESC OFFSET CONVERT(int,?) ROWS FETCH NEXT 50 ROWS ONLY`, [...params, String((page - 1) * 50)]);
    return rows.map(row => ({ ...row, amount: formatMoney(row.amount, row.currencyPrecision) }));
  },
  async listReceiptCustomers(operatorId, period) {
    const params: string[] = [operatorId];
    const periodFilter = period ? 'AND per.DisplayName=?' : '';
    if (period) params.push(period);
    return sql<U9Customer>(`SELECT DISTINCT CONVERT(varchar(20),c.ID) id, c.Name name
      ${receiptFrom} ${periodFilter} ORDER BY c.Name`, params);
  },
  async getDocument(kind, operatorId, id) {
    const { from, amount, date } = source(kind);
    const rows = await sql<Record<string, unknown>>(`SELECT h.DocNo docNo, CONVERT(varchar(10),${date},23) date,
      c.Name customer, cur.Name currency, currency.MoneyRound_Precision currencyPrecision, h.DocStatus status, s.DocNo shipNo, CONVERT(varchar(50),COALESCE(${amount},0)) amount
      ${from} AND h.ID=CONVERT(bigint,?) ORDER BY s.DocNo`, [operatorId, id]);
    if (!rows.length) return null;
    return { id, docNo: String(rows[0].docNo), date: rows[0].date, customer: rows[0].customer, currency: rows[0].currency, currencyPrecision: rows[0].currencyPrecision, status: rows[0].status, lines: rows.map(row => ({ shipNo: row.shipNo, amount: row.amount })) };
  },
  async getReceiptDocument(operatorId, id) {
    const rows = await sql<Record<string, unknown>>(receiptDocumentSql, [id, operatorId]);
    if (!rows.length) return null;
    return {
      id,
      docNo: String(rows[0].docNo || ''),
      customer: String(rows[0].customer || '-'),
      businessDate: String(rows[0].businessDate || ''),
      totalAmount: formatMoney(rows[0].totalAmount, 2),
      status: rows[0].status,
      lines: rows.map(receiptDocumentLine),
    };
  },
  async listReceivableDocuments(operatorId, page = 1, query) {
    if (!query.period && !query.customerId && !query.customerKeyword) return [];
    const conditions = [receivableHeadWhere];
    const params: string[] = [operatorId];
    if (query.period) {
      const { start, end } = periodRange(query.period);
      conditions.push('h.BusinessDate >= CONVERT(date,?)', 'h.BusinessDate < CONVERT(date,?)', 'per.DisplayName=?');
      params.push(start, end, query.period);
    }
    if (query.customerId) {
      conditions.push('h.AccrueCust_Customer=CONVERT(bigint,?)');
      params.push(query.customerId);
    } else if (query.customerKeyword) {
      conditions.push("c.Name LIKE ? ESCAPE '\\'");
      params.push(likePattern(query.customerKeyword));
    }
    const heads = await sql<Record<string, unknown>>(`${receivableHeadSelect} ${receivableHeadJoins}
      WHERE ${conditions.join(' AND ')}
      GROUP BY h.ID ORDER BY MAX(h.BusinessDate) DESC,h.ID DESC
      OFFSET CONVERT(int,?) ROWS FETCH NEXT 50 ROWS ONLY`, [...params, String((page - 1) * 50)]);
    if (!heads.length) return [];
    const ids = heads.map(row => String(row.id));
    const rows = await sql<Record<string, unknown>>(receivableLineSql(ids.length), [...ids, operatorId]);
    const grouped = new Map<string, U9ReceivableLine[]>();
    for (const row of rows) {
      const docId = String(row.docId);
      const line = receivableLine(row);
      const lines = grouped.get(docId);
      if (lines) lines.push(line); else grouped.set(docId, [line]);
    }
    return heads.map(row => receivableDocument(row, grouped.get(String(row.id)) || []));
  },
  async listReceivableCustomers(operatorId, period) {
    const conditions = [receivableCustomerWhere];
    const params: string[] = [operatorId];
    if (period) {
      conditions.push('per.DisplayName=?');
      params.push(period);
    }
    return sql<U9Customer>(`SELECT DISTINCT CONVERT(varchar(20),c.ID) id, c.Name name
      ${receivableCustomerJoins}
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.Name`, params);
  },
  async getReceivableDocument(operatorId, id) {
    const heads = await sql<Record<string, unknown>>(receivableDetailSql, [operatorId, id]);
    if (!heads.length) return null;
    const rows = await sql<Record<string, unknown>>(receivableLineSql(1), [id, operatorId]);
    return receivableDocument(heads[0], rows.map(receivableLine));
  },
  async listReceiptsForNotification(sinceDate, orgCode) {
    const rows = await sql<Record<string, unknown>>(receiptNotificationSql, [orgCode, sinceDate]);
    const grouped = new Map<string, U9ReceiptNotification>();
    for (const row of rows) {
      const id = String(row.id);
      let document = grouped.get(id);
      if (!document) {
        document = {
          id,
          docNo: String(row.docNo || ''),
          customerName: String(row.customerName || ''),
          businessDate: String(row.businessDate || ''),
          totalAmount: formatMoney(row.totalAmount, 2),
          orgName: String(row.orgName || ''),
          transactorId: String(row.transactorId || ''),
          lines: [],
        };
        grouped.set(id, document);
      }
      document.lines.push(receiptNotificationLine(row));
    }
    return [...grouped.values()];
  },
  async getSummary(operatorId, fromPeriod, toPeriod) {
    // 存储过程拼接筛选表达式，只能使用服务端校验过的十进制 ID，绝不能拼接客户端文本。
    if (!/^\d{1,19}$/.test(operatorId)) throw new Error('无效的 U9 业务员 ID');
    const operator = await this.getOperator(operatorId);
    if (!operator || !/^\d{1,19}$/.test(operator.orgId)) throw new HttpError(403, 403, '绑定的 U9 业务员不存在');
    return sql<Record<string, unknown>>(`SET NOCOUNT ON; CREATE TABLE #codex_summary (
      CustomerID bigint, CustomerCode nvarchar(50), CustomerName nvarchar(255), ARTerm nvarchar(255),
      Saleser nvarchar(255), RowNum bigint, DisplayName nvarchar(50), UnRecMoney decimal(38,9), Currency bigint, MoneyPrecision int);
      INSERT INTO #codex_summary EXEC dbo.SP_HIARC_Rpt_JXYouke_CustomerRecInfo @CustWhere=?, @FromPeriod=?, @ToPeriod=?, @Org=?;
      SELECT s.CustomerCode,s.CustomerName,s.ARTerm,s.Saleser,s.RowNum,s.DisplayName,
        CONVERT(varchar(60),s.UnRecMoney) UnRecMoney, COALESCE(t.Name, '-') CurrencyName, s.MoneyPrecision
      FROM #codex_summary s LEFT JOIN Base_Currency_Trl t ON t.ID=s.Currency AND t.SysMLFlag='zh-CN'
      ORDER BY s.CustomerCode,s.RowNum`, [`cust.Saleser=${operatorId}`, fromPeriod, toPeriod, operator.orgId]);
  },
};
