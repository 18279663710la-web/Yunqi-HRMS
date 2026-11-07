import type { U9Document, U9DocumentKind, U9Gateway, U9Operator } from './types';
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
  WHERE sl.Seller=CONVERT(bigint,?) AND h.Cancel_Canceled=0 AND h.DocStatus>1 AND s.Cancel_Canceled=0`;

function source(kind: U9DocumentKind): { from: string; amount: string; date: string } {
  return kind === 'receivables'
    ? { from: arFrom, amount: 'a.AROCMoney_TotalMoney', date: 'h.BusinessDate' }
    : { from: receiptFrom, amount: 'ap.CRApplyOCMoney_TotalMoney', date: 'h.BusinessDate' };
}

export const sqlServerU9: U9Gateway = {
  async searchOperators(keyword) {
    return sql<U9Operator>(`${operatorSelect} WHERE (?='' OR o.Code LIKE ? OR t.Name LIKE ?) ORDER BY t.Name,o.Code`, [keyword, `%${keyword}%`, `%${keyword}%`]);
  },
  async getOperator(id) {
    const rows = await sql<U9Operator>(`${operatorSelect} WHERE o.ID=CONVERT(bigint,?)`, [id]);
    return rows[0] || null;
  },
  async listDocuments(kind, operatorId, page = 1) {
    const { from, amount, date } = source(kind);
    const rows = await sql<U9Document>(`SELECT CONVERT(varchar(20),h.ID) id, h.DocNo docNo, CONVERT(varchar(10),${date},23) date,
      MAX(c.Name) customer, MAX(cur.Name) currency, MAX(currency.MoneyRound_Precision) currencyPrecision, CONVERT(varchar(50),SUM(COALESCE(${amount},0))) amount, MAX(h.DocStatus) status
      ${from} GROUP BY h.ID,h.DocNo,${date} ORDER BY ${date} DESC,h.ID DESC OFFSET CONVERT(int,?) ROWS FETCH NEXT 50 ROWS ONLY`, [operatorId, String((page - 1) * 50)]);
    return rows.map(row => ({ ...row, amount: formatMoney(row.amount, row.currencyPrecision) }));
  },
  async getDocument(kind, operatorId, id) {
    const { from, amount, date } = source(kind);
    const rows = await sql<Record<string, unknown>>(`SELECT h.DocNo docNo, CONVERT(varchar(10),${date},23) date,
      c.Name customer, cur.Name currency, currency.MoneyRound_Precision currencyPrecision, h.DocStatus status, s.DocNo shipNo, CONVERT(varchar(50),COALESCE(${amount},0)) amount
      ${from} AND h.ID=CONVERT(bigint,?) ORDER BY s.DocNo`, [operatorId, id]);
    if (!rows.length) return null;
    return { id, docNo: String(rows[0].docNo), date: rows[0].date, customer: rows[0].customer, currency: rows[0].currency, currencyPrecision: rows[0].currencyPrecision, status: rows[0].status, lines: rows.map(row => ({ shipNo: row.shipNo, amount: row.amount })) };
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
