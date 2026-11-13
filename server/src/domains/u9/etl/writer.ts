import { execute, queryOne, transaction } from '../../../shared/db/pool';
import type {
  AssembledArHead,
  AssembledArLine,
  AssembledOperator,
  AssembledRecHead,
  AssembledRecLine,
  AssembledRecSeller,
} from './assemble';

export interface MirrorSummaryRow {
  operatorId: string;
  fromPeriod: string;
  toPeriod: string;
  customerCode: string;
  customerName: string;
  arTerm: string;
  saleser: string;
  rowNum: number;
  displayName: string;
  unRecMoney: string;
  currencyName: string;
  moneyPrecision: number;
}

export async function upsertOperators(rows: AssembledOperator[]): Promise<void> {
  for (const row of rows) {
    await execute(
      `INSERT INTO u9_mirror_operators (id,code,name,org_id,org_name,synced_at)
       VALUES (?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE code=VALUES(code),name=VALUES(name),org_id=VALUES(org_id),
         org_name=VALUES(org_name),synced_at=VALUES(synced_at)`,
      [row.id, row.code, row.name, row.orgId, row.orgName]
    );
  }
}

export async function upsertArBundle(
  heads: AssembledArHead[],
  lines: AssembledArLine[]
): Promise<void> {
  await transaction(async (conn) => {
    for (const h of heads) {
      await conn.query(
        `INSERT INTO u9_mirror_ar_heads
          (id,doc_no,customer_id,customer_name,business_date,post_period,src_org,invoice_date,invoice_num,
           currency_name,currency_precision,doc_status,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE doc_no=VALUES(doc_no),customer_id=VALUES(customer_id),customer_name=VALUES(customer_name),
           business_date=VALUES(business_date),post_period=VALUES(post_period),src_org=VALUES(src_org),
           invoice_date=VALUES(invoice_date),invoice_num=VALUES(invoice_num),currency_name=VALUES(currency_name),
           currency_precision=VALUES(currency_precision),doc_status=VALUES(doc_status),synced_at=VALUES(synced_at)`,
        [
          h.id, h.docNo, h.customerId, h.customerName, h.businessDate, h.postPeriod, h.srcOrg,
          h.invoiceDate, h.invoiceNum, h.currencyName, h.currencyPrecision, h.docStatus,
        ]
      );
    }
    for (const l of lines) {
      await conn.query(
        `INSERT INTO u9_mirror_ar_lines
          (id,doc_id,seller_operator_id,line_num,src_ship_no,src_line_num,item_name,item_code,uom,qty,
           non_tax_price,tax_price,non_tax_amount,tax_amount,tax_included_total,total_amount,total_balance,
           own_amount,biz_org,maturity,line_status,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE doc_id=VALUES(doc_id),seller_operator_id=VALUES(seller_operator_id),
           line_num=VALUES(line_num),src_ship_no=VALUES(src_ship_no),src_line_num=VALUES(src_line_num),
           item_name=VALUES(item_name),item_code=VALUES(item_code),uom=VALUES(uom),qty=VALUES(qty),
           non_tax_price=VALUES(non_tax_price),tax_price=VALUES(tax_price),non_tax_amount=VALUES(non_tax_amount),
           tax_amount=VALUES(tax_amount),tax_included_total=VALUES(tax_included_total),total_amount=VALUES(total_amount),
           total_balance=VALUES(total_balance),own_amount=VALUES(own_amount),biz_org=VALUES(biz_org),
           maturity=VALUES(maturity),line_status=VALUES(line_status),synced_at=VALUES(synced_at)`,
        [
          l.id, l.docId, l.sellerOperatorId, l.lineNum, l.srcShipNo, l.srcLineNum, l.itemName, l.itemCode,
          l.uom, l.qty, l.nonTaxPrice, l.taxPrice, l.nonTaxAmount, l.taxAmount, l.taxIncludedTotal,
          l.totalAmount, l.totalBalance, l.ownAmount, l.bizOrg, l.maturity, l.lineStatus,
        ]
      );
    }
  });
}

export async function upsertRecBundle(
  heads: AssembledRecHead[],
  lines: AssembledRecLine[],
  sellers: AssembledRecSeller[]
): Promise<void> {
  await transaction(async (conn) => {
    for (const h of heads) {
      await conn.query(
        `INSERT INTO u9_mirror_rec_heads
          (id,doc_no,customer_id,customer_name,business_date,post_period,org_id,org_code,org_name,
           transactor_id,total_amount,currency_name,currency_precision,doc_status,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE doc_no=VALUES(doc_no),customer_id=VALUES(customer_id),customer_name=VALUES(customer_name),
           business_date=VALUES(business_date),post_period=VALUES(post_period),org_id=VALUES(org_id),
           org_code=VALUES(org_code),org_name=VALUES(org_name),transactor_id=VALUES(transactor_id),
           total_amount=VALUES(total_amount),currency_name=VALUES(currency_name),
           currency_precision=VALUES(currency_precision),doc_status=VALUES(doc_status),synced_at=VALUES(synced_at)`,
        [
          h.id, h.docNo, h.customerId, h.customerName, h.businessDate, h.postPeriod, h.orgId, h.orgCode,
          h.orgName, h.transactorId, h.totalAmount, h.currencyName, h.currencyPrecision, h.docStatus,
        ]
      );
    }
    for (const l of lines) {
      await conn.query(
        `INSERT INTO u9_mirror_rec_lines
          (id,doc_id,line_num,settlement_method,note_no,amount,bank_account,synced_at)
         VALUES (?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE doc_id=VALUES(doc_id),line_num=VALUES(line_num),
           settlement_method=VALUES(settlement_method),note_no=VALUES(note_no),amount=VALUES(amount),
           bank_account=VALUES(bank_account),synced_at=VALUES(synced_at)`,
        [l.id, l.docId, l.lineNum, l.settlementMethod, l.noteNo, l.amount, l.bankAccount]
      );
    }
    for (const s of sellers) {
      await conn.query(
        `INSERT INTO u9_mirror_rec_sellers (doc_id,seller_operator_id,own_amount,synced_at)
         VALUES (?,?,?,NOW())
         ON DUPLICATE KEY UPDATE own_amount=VALUES(own_amount),synced_at=VALUES(synced_at)`,
        [s.docId, s.sellerOperatorId, s.ownAmount]
      );
    }
  });
}

export async function replaceSummaryRows(
  operatorId: string,
  fromPeriod: string,
  toPeriod: string,
  rows: MirrorSummaryRow[]
): Promise<void> {
  await transaction(async (conn) => {
    await conn.query(
      'DELETE FROM u9_mirror_summary_rows WHERE operator_id=? AND from_period=? AND to_period=?',
      [operatorId, fromPeriod, toPeriod]
    );
    for (const row of rows) {
      await conn.query(
        `INSERT INTO u9_mirror_summary_rows
          (operator_id,from_period,to_period,customer_code,customer_name,ar_term,saleser,row_num,
           display_name,un_rec_money,currency_name,money_precision,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [
          row.operatorId, row.fromPeriod, row.toPeriod, row.customerCode, row.customerName, row.arTerm,
          row.saleser, row.rowNum, row.displayName, row.unRecMoney, row.currencyName, row.moneyPrecision,
        ]
      );
    }
  });
}

/** 删除该业务员下 to_period 不是当月快照的旧汇总行（换月残留）。 */
export async function deleteSummaryRowsExceptTo(operatorId: string, toPeriod: string): Promise<void> {
  await execute(
    'DELETE FROM u9_mirror_summary_rows WHERE operator_id=? AND to_period<>?',
    [operatorId, toPeriod]
  );
}

export async function getSyncWatermark(): Promise<string | null> {
  const row = await queryOne<{ watermark_date: string | null }>(
    "SELECT DATE_FORMAT(watermark_date,'%Y-%m-%d') watermark_date FROM u9_mirror_sync_state WHERE id=1"
  );
  return row?.watermark_date || null;
}

export async function ensureSyncState(): Promise<void> {
  await execute(
    'INSERT IGNORE INTO u9_mirror_sync_state (id,watermark_date,updated_at) VALUES (1,NULL,NOW())'
  );
}

export async function beginSyncRun(mode: string): Promise<number> {
  const result = await execute(
    'INSERT INTO u9_mirror_sync_runs (mode,started_at) VALUES (?,NOW())',
    [mode]
  );
  return Number(result.insertId);
}

export async function finishSyncRun(
  runId: number,
  success: boolean,
  errorMessage?: string,
  stats?: Record<string, unknown>
): Promise<void> {
  await execute(
    `UPDATE u9_mirror_sync_runs SET finished_at=NOW(), success=?, error_message=?, stats_json=? WHERE id=?`,
    [success ? 1 : 0, errorMessage || null, stats ? JSON.stringify(stats) : null, runId]
  );
}

/** 仅成功时前移水位。 */
export async function advanceWatermark(date: string, mode: string): Promise<void> {
  await execute(
    `UPDATE u9_mirror_sync_state
     SET watermark_date=?, last_success_at=NOW(), last_mode=?, updated_at=NOW()
     WHERE id=1`,
    [date, mode]
  );
}

export async function getLastSuccessAt(): Promise<string | null> {
  const row = await queryOne<{ last_success_at: string | null }>(
    "SELECT DATE_FORMAT(last_success_at,'%Y-%m-%d %H:%i:%s') last_success_at FROM u9_mirror_sync_state WHERE id=1"
  );
  return row?.last_success_at || null;
}
