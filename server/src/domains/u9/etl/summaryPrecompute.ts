import { queryRows } from '../../../shared/db/pool';
import { sqlServerU9 } from '../sqlServerGateway';
import { formatMoney } from '../money';
import { deleteSummaryRowsExceptTo, replaceSummaryRows, type MirrorSummaryRow } from './writer';

const SUMMARY_SP_CONCURRENCY = 2;

function listMonthsInclusive(fromMonth: string, toMonth: string): string[] {
  const [fromYear, fromMo] = fromMonth.split('-').map(Number);
  const [toYear, toMo] = toMonth.split('-').map(Number);
  const months: string[] = [];
  let year = fromYear;
  let month = fromMo;
  while (year < toYear || (year === toYear && month <= toMo)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function mapSummaryRows(
  operatorId: string,
  fromPeriod: string,
  toPeriod: string,
  rows: Record<string, unknown>[]
): MirrorSummaryRow[] {
  return rows.map((row) => ({
    operatorId,
    fromPeriod,
    toPeriod,
    customerCode: String(row.CustomerCode || ''),
    customerName: String(row.CustomerName || ''),
    arTerm: String(row.ARTerm || ''),
    saleser: String(row.Saleser || ''),
    rowNum: Number(row.RowNum || 0),
    displayName: String(row.DisplayName || ''),
    // 空月 UnRecMoney 为 null；不可经 formatMoney 写成 '-'，否则汇总 PDF 合计会失败
    unRecMoney:
      row.UnRecMoney === null || row.UnRecMoney === undefined || row.UnRecMoney === ''
        ? ''
        : formatMoney(row.UnRecMoney, row.MoneyPrecision),
    currencyName: String(row.CurrencyName || '-'),
    moneyPrecision: Number(row.MoneyPrecision ?? 2),
  }));
}

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 按绑定业务员预存所有 (from, to=当月) 的 SP 快照，供员工任意 from 查询。
 * 仅应在 nightly / bootstrap 调用；白天 incremental 不再跑汇总。
 */
export async function precomputeSummariesForBoundOperators(
  rangeFromMonth: string,
  toMonth: string
): Promise<number> {
  const bindings = await queryRows<{ operator_id: string }>(
    `SELECT DISTINCT operator_id FROM u9_employee_bindings`
  );
  const fromMonths = listMonthsInclusive(rangeFromMonth, toMonth);
  let count = 0;
  for (const { operator_id } of bindings) {
    // SP 限并发；同一业务员写入串行，避免 replace 事务死锁
    const batches = await mapPool(fromMonths, SUMMARY_SP_CONCURRENCY, async (fromPeriod) => {
      const rows = (await sqlServerU9.getSummary?.(operator_id, fromPeriod, toMonth)) || [];
      return { fromPeriod, mapped: mapSummaryRows(operator_id, fromPeriod, toMonth, rows) };
    });
    for (const { fromPeriod, mapped } of batches) {
      await replaceSummaryRows(operator_id, fromPeriod, toMonth, mapped);
      count += mapped.length;
    }
    await deleteSummaryRowsExceptTo(operator_id, toMonth);
  }
  return count;
}
