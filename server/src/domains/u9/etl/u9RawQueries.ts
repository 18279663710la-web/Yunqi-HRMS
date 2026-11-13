import { config } from '../../../config';
import { chunkIds, u9Sql } from '../sqlClient';

/**
 * U9 单表抽取。硬性约束：本文件 SQL 不得多表关联，只能单表按主键/过滤条件查询。
 * 关联在 assemble 层按 ID 拼接。
 */

export type RawRow = Record<string, unknown>;

function inChunk(): number {
  return config.u9Mirror.inChunk;
}

/** 只保留可安全 CONVERT(bigint) 的 ID，避免空串/非数字打崩抽取。 */
function numericIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter((id) => /^\d{1,19}$/.test(id)))];
}

async function byIds(tableSql: string, ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    const part = await u9Sql<RawRow>(`${tableSql} WHERE ID IN (${placeholders})`, chunk);
    rows.push(...part);
  }
  return rows;
}

export async function fetchOperatorsByIds(ids: string[]): Promise<RawRow[]> {
  return byIds(
    `SELECT CONVERT(varchar(20),ID) id, Code code, CONVERT(varchar(20),Org) orgId FROM CBO_Operators`,
    ids
  );
}

export async function fetchOperatorTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, Name name FROM CBO_Operators_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchOrgTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, Name name FROM Base_Organization_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchOrganizationsByIds(ids: string[]): Promise<RawRow[]> {
  return byIds(`SELECT CONVERT(varchar(20),ID) id, Code code FROM Base_Organization`, ids);
}

export async function fetchOrganizationsByCode(code: string): Promise<RawRow[]> {
  return u9Sql<RawRow>(
    `SELECT CONVERT(varchar(20),ID) id, Code code FROM Base_Organization WHERE Code=?`,
    [code]
  );
}

export async function fetchCustomerTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, Name name FROM CBO_Customer_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchCurrencyByIds(ids: string[]): Promise<RawRow[]> {
  return byIds(
    `SELECT CONVERT(varchar(20),ID) id, CONVERT(varchar(20),MoneyRound_Precision) moneyPrecision FROM Base_Currency`,
    ids
  );
}

export async function fetchCurrencyTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, Name name FROM Base_Currency_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchPeriodsByIds(ids: string[]): Promise<RawRow[]> {
  return byIds(
    `SELECT CONVERT(varchar(20),ID) id, DisplayName displayName FROM Base_SOBAccountingPeriod`,
    ids
  );
}

export async function fetchUomTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, Name name FROM Base_UOM_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchSettlementMethodTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, Name name FROM CBO_SettlementMethod_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchBankAccountTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, Name name FROM CBO_BankAccount_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

/** 单表取最早业务日期，供部署全量起点（无关联）。 */
export async function fetchMinArBusinessDate(): Promise<string | null> {
  const rows = await u9Sql<{ minDate: string | null }>(
    `SELECT CONVERT(varchar(10), MIN(BusinessDate), 23) minDate
     FROM AR_ARBillHead
     WHERE Cancel_Canceled=0 AND DocStatus>1 AND BusinessDate IS NOT NULL`
  );
  return rows[0]?.minDate || null;
}

export async function fetchMinRecBusinessDate(): Promise<string | null> {
  const rows = await u9Sql<{ minDate: string | null }>(
    `SELECT CONVERT(varchar(10), MIN(BusinessDate), 23) minDate
     FROM AR_RecBillHead
     WHERE Cancel_Canceled=0 AND DocStatus>1 AND BusinessDate IS NOT NULL`
  );
  return rows[0]?.minDate || null;
}

export async function fetchArHeadsByBusinessDateRange(start: string, endExclusive: string): Promise<RawRow[]> {
  return u9Sql<RawRow>(
    `SELECT CONVERT(varchar(20),ID) id, DocNo docNo,
      CONVERT(varchar(20),AccrueCust_Customer) customerId,
      CONVERT(varchar(10),BusinessDate,23) businessDate,
      CONVERT(varchar(20),PostPeriod) postPeriodId,
      CONVERT(varchar(20),SrcOrg) srcOrgId,
      CONVERT(varchar(10),InvoiceDate,23) invoiceDate,
      InvoiceNum invoiceNum,
      CONVERT(varchar(20),AC) currencyId,
      DocStatus docStatus,
      Cancel_Canceled cancelCanceled
     FROM AR_ARBillHead
     WHERE BusinessDate >= CONVERT(date,?) AND BusinessDate < CONVERT(date,?)`,
    [start, endExclusive]
  );
}

export async function fetchArHeadsByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, DocNo docNo,
          CONVERT(varchar(20),AccrueCust_Customer) customerId,
          CONVERT(varchar(10),BusinessDate,23) businessDate,
          CONVERT(varchar(20),PostPeriod) postPeriodId,
          CONVERT(varchar(20),SrcOrg) srcOrgId,
          CONVERT(varchar(10),InvoiceDate,23) invoiceDate,
          InvoiceNum invoiceNum,
          CONVERT(varchar(20),AC) currencyId,
          DocStatus docStatus,
          Cancel_Canceled cancelCanceled
         FROM AR_ARBillHead WHERE ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

const arLineSelect = `SELECT CONVERT(varchar(20),ID) id,
  CONVERT(varchar(20),ARBillHead) docId,
  LineNum lineNum,
  CONVERT(varchar(20),SrcDataID) srcShipLineId,
  CONVERT(varchar(20),SrcBillID) srcShipId,
  Item_ItemName itemName, Item_ItemCode itemCode,
  CONVERT(varchar(20),PUom) uomId,
  CONVERT(varchar(50),PUAmount) qty,
  CONVERT(varchar(50),NonTaxPrice) nonTaxPrice,
  CONVERT(varchar(50),TaxPrice) taxPrice,
  CONVERT(varchar(60),AROCMoney_NonTax) nonTaxAmount,
  CONVERT(varchar(60),AROCMoney_Tax) taxAmount,
  CONVERT(varchar(60),AROCMoney_TotalMoney) taxIncludedTotal,
  CONVERT(varchar(60),ARFCMoney_TotalMoney) totalAmount,
  CONVERT(varchar(60),ARFCMoneyBalance_TotalMoney) totalBalance,
  CONVERT(varchar(20),BizOrg) bizOrgId,
  CONVERT(varchar(10),Maturity,23) maturity,
  RedFlushStatus redFlushStatus,
  IsRedFlush isRedFlush
 FROM AR_ARBillLine`;

export async function fetchArLinesByHeadIds(headIds: string[]): Promise<RawRow[]> {
  const unique = numericIds(headIds);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(`${arLineSelect} WHERE ARBillHead IN (${placeholders})`, chunk))
    );
  }
  return rows;
}

export async function fetchArLinesByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(...(await u9Sql<RawRow>(`${arLineSelect} WHERE ID IN (${placeholders})`, chunk)));
  }
  return rows;
}

export async function fetchShipLinesByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id,
          CONVERT(varchar(20),Ship) shipId,
          DocLineNo docLineNo,
          CONVERT(varchar(20),Seller) sellerId
         FROM SM_ShipLine WHERE ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchShipsByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, DocNo docNo, Cancel_Canceled cancelCanceled
         FROM SM_Ship WHERE ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchRecHeadsByBusinessDateRange(start: string, endExclusive: string): Promise<RawRow[]> {
  return u9Sql<RawRow>(
    `SELECT CONVERT(varchar(20),ID) id, DocNo docNo,
      CONVERT(varchar(20),Cust_Customer) customerId,
      Cust_ShortName custShortName, Cust_Code custCode,
      CONVERT(varchar(10),BusinessDate,23) businessDate,
      CONVERT(varchar(20),PostPeriod) postPeriodId,
      CONVERT(varchar(20),Org) orgId,
      CONVERT(varchar(20),Transactor) transactorId,
      CONVERT(varchar(60),TotalMoney_OCMoney) totalAmount,
      CONVERT(varchar(20),AC) currencyId,
      DocStatus docStatus,
      Cancel_Canceled cancelCanceled
     FROM AR_RecBillHead
     WHERE BusinessDate >= CONVERT(date,?) AND BusinessDate < CONVERT(date,?)`,
    [start, endExclusive]
  );
}

export async function fetchRecLinesByHeadIds(headIds: string[]): Promise<RawRow[]> {
  const unique = numericIds(headIds);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id,
          CONVERT(varchar(20),RecBillHead) docId,
          LineNum lineNum,
          CONVERT(varchar(20),SettlementMethod) settlementMethodId,
          CONVERT(varchar(60),Money_OCMoney) amount,
          CONVERT(varchar(20),RecBkAccount) bankAccountId,
          RecBkAccName recBkAccName
         FROM AR_RecBillLine WHERE RecBillHead IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

export async function fetchRecLineTrlByIds(ids: string[]): Promise<RawRow[]> {
  const unique = numericIds(ids);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id, NoteNo noteNo FROM AR_RecBillLine_Trl
         WHERE SysMLFlag='zh-CN' AND ID IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}

/** 核销行：CRBillTag=收款单，DRBillTag/DRBillLineTag=应收 */
export async function fetchApplyLinesByRecHeadIds(recHeadIds: string[]): Promise<RawRow[]> {
  const unique = numericIds(recHeadIds);
  if (!unique.length) return [];
  const rows: RawRow[] = [];
  for (const chunk of chunkIds(unique, inChunk())) {
    const placeholders = chunk.map(() => 'CONVERT(bigint,?)').join(',');
    rows.push(
      ...(await u9Sql<RawRow>(
        `SELECT CONVERT(varchar(20),ID) id,
          CONVERT(varchar(20),CRBillTag) recHeadId,
          CONVERT(varchar(20),CRDataTag) recUseLineId,
          CONVERT(varchar(20),DRBillTag) arHeadId,
          CONVERT(varchar(20),DRBillLineTag) arLineId,
          CONVERT(varchar(60),CRApplyOCMoney_TotalMoney) applyAmount
         FROM AR_ARApplyLine WHERE CRBillTag IN (${placeholders})`,
        chunk
      ))
    );
  }
  return rows;
}
