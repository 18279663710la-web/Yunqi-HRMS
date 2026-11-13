import { queryRows } from '../../../shared/db/pool';
import { sqlServerU9 } from '../sqlServerGateway';
import { formatMoney } from '../money';
import { replaceSummaryRows, type MirrorSummaryRow } from './writer';

/** 汇总仍以 U9 原报表过程为准，仅在抽取窗口按业务员预计算写入镜像，员工查询不再调过程。 */
export async function precomputeSummariesForBoundOperators(
  fromPeriod: string,
  toPeriod: string
): Promise<number> {
  const bindings = await queryRows<{ operator_id: string }>(
    `SELECT DISTINCT operator_id FROM u9_employee_bindings`
  );
  let count = 0;
  for (const { operator_id } of bindings) {
    const rows = (await sqlServerU9.getSummary?.(operator_id, fromPeriod, toPeriod)) || [];
    const mapped: MirrorSummaryRow[] = rows.map((row) => ({
      operatorId: operator_id,
      fromPeriod,
      toPeriod,
      customerCode: String(row.CustomerCode || ''),
      customerName: String(row.CustomerName || ''),
      arTerm: String(row.ARTerm || ''),
      saleser: String(row.Saleser || ''),
      rowNum: Number(row.RowNum || 0),
      displayName: String(row.DisplayName || ''),
      unRecMoney: formatMoney(row.UnRecMoney, row.MoneyPrecision),
      currencyName: String(row.CurrencyName || '-'),
      moneyPrecision: Number(row.MoneyPrecision ?? 2),
    }));
    await replaceSummaryRows(operator_id, fromPeriod, toPeriod, mapped);
    count += mapped.length;
  }
  return count;
}
