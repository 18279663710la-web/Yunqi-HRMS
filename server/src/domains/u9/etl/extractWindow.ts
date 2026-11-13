import { config } from '../../../config';
import {
  assembleArDocuments,
  assembleOperators,
  assembleRecDocuments,
} from './assemble';
import * as raw from './u9RawQueries';
import { upsertArBundle, upsertOperators, upsertRecBundle } from './writer';

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ExtractStats {
  arHeads: number;
  arLines: number;
  recHeads: number;
  recLines: number;
  recSellers: number;
  operators: number;
}

/** 按业务日期窗口从 U9 分表抽取并写入镜像（无 JOIN）。endExclusive 不含当日。 */
export async function extractBusinessDateWindow(
  start: string,
  endExclusive: string
): Promise<ExtractStats> {
  const arHeadsRaw = await raw.fetchArHeadsByBusinessDateRange(start, endExclusive);
  const arHeadIds = arHeadsRaw.map((h) => String(h.id));
  const arLinesRaw = await raw.fetchArLinesByHeadIds(arHeadIds);
  const shipLineIds = arLinesRaw.map((l) => String(l.srcShipLineId));
  const shipLinesRaw = await raw.fetchShipLinesByIds(shipLineIds);
  const shipIds = shipLinesRaw.map((s) => String(s.shipId));
  const shipsRaw = await raw.fetchShipsByIds(shipIds);

  const customerIds = arHeadsRaw.map((h) => String(h.customerId));
  const periodIds = arHeadsRaw.map((h) => String(h.postPeriodId));
  const orgIds = [
    ...arHeadsRaw.map((h) => String(h.srcOrgId)),
    ...arLinesRaw.map((l) => String(l.bizOrgId)),
  ];
  const currencyIds = arHeadsRaw.map((h) => String(h.currencyId));
  const uomIds = arLinesRaw.map((l) => String(l.uomId));
  const sellerIds = shipLinesRaw.map((s) => String(s.sellerId));

  const [customers, periods, orgs, currencies, currencyTrls, uoms] = await Promise.all([
    raw.fetchCustomerTrlByIds(customerIds),
    raw.fetchPeriodsByIds(periodIds),
    raw.fetchOrgTrlByIds(orgIds),
    raw.fetchCurrencyByIds(currencyIds),
    raw.fetchCurrencyTrlByIds(currencyIds),
    raw.fetchUomTrlByIds(uomIds),
  ]);

  const ar = assembleArDocuments({
    heads: arHeadsRaw,
    lines: arLinesRaw,
    shipLines: shipLinesRaw,
    ships: shipsRaw,
    customers,
    periods,
    orgs,
    currencies,
    currencyTrls,
    uoms,
  });
  await upsertArBundle(ar.heads, ar.lines);

  const recHeadsRaw = await raw.fetchRecHeadsByBusinessDateRange(start, endExclusive);
  const recHeadIds = recHeadsRaw.map((h) => String(h.id));
  const recLinesRaw = await raw.fetchRecLinesByHeadIds(recHeadIds);
  const recLineIds = recLinesRaw.map((l) => String(l.id));
  const applyLines = await raw.fetchApplyLinesByRecHeadIds(recHeadIds);
  const filteredArLines = await raw.fetchArLinesByIds(applyLines.map((a) => String(a.arLineId)));
  const applyShipLines = await raw.fetchShipLinesByIds(
    filteredArLines.map((l) => String(l.srcShipLineId))
  );
  const applyShips = await raw.fetchShipsByIds(applyShipLines.map((s) => String(s.shipId)));

  const recCustomerIds = recHeadsRaw.map((h) => String(h.customerId));
  const recPeriodIds = recHeadsRaw.map((h) => String(h.postPeriodId));
  const recOrgIds = recHeadsRaw.map((h) => String(h.orgId));
  const recCurrencyIds = recHeadsRaw.map((h) => String(h.currencyId));
  const settlementIds = recLinesRaw.map((l) => String(l.settlementMethodId));
  const bankIds = recLinesRaw.map((l) => String(l.bankAccountId));
  const transactorIds = recHeadsRaw.map((h) => String(h.transactorId));

  const [
    recCustomers,
    recPeriods,
    recOrgs,
    recOrgCodes,
    recCurrencies,
    recCurrencyTrls,
    settlements,
    banks,
    lineTrls,
  ] = await Promise.all([
    raw.fetchCustomerTrlByIds(recCustomerIds),
    raw.fetchPeriodsByIds(recPeriodIds),
    raw.fetchOrgTrlByIds(recOrgIds),
    raw.fetchOrganizationsByIds(recOrgIds),
    raw.fetchCurrencyByIds(recCurrencyIds),
    raw.fetchCurrencyTrlByIds(recCurrencyIds),
    raw.fetchSettlementMethodTrlByIds(settlementIds),
    raw.fetchBankAccountTrlByIds(bankIds),
    raw.fetchRecLineTrlByIds(recLineIds),
  ]);

  const rec = assembleRecDocuments({
    heads: recHeadsRaw,
    lines: recLinesRaw,
    lineTrls,
    applyLines,
    arLines: filteredArLines,
    shipLines: applyShipLines,
    ships: applyShips,
    customers: recCustomers,
    periods: recPeriods,
    orgs: recOrgs,
    orgCodes: recOrgCodes,
    currencies: recCurrencies,
    currencyTrls: recCurrencyTrls,
    settlements,
    banks,
  });
  await upsertRecBundle(rec.heads, rec.lines, rec.sellers);

  const allOperatorIds = [
    ...sellerIds,
    ...applyShipLines.map((s) => String(s.sellerId)),
    ...transactorIds,
  ];
  const operatorsRaw = await raw.fetchOperatorsByIds(allOperatorIds);
  const operatorTrls = await raw.fetchOperatorTrlByIds(allOperatorIds);
  const operatorOrgTrls = await raw.fetchOrgTrlByIds(operatorsRaw.map((o) => String(o.orgId)));
  const operators = assembleOperators(operatorsRaw, operatorTrls, operatorOrgTrls);
  await upsertOperators(operators);

  return {
    arHeads: ar.heads.length,
    arLines: ar.lines.length,
    recHeads: rec.heads.length,
    recLines: rec.lines.length,
    recSellers: rec.sellers.length,
    operators: operators.length,
  };
}

export function incrementalRange(watermark: string | null, today: string): { start: string; endExclusive: string } {
  const lookback = Math.max(1, config.u9Mirror.lookbackDays);
  const start = watermark
    ? addDays(watermark, -lookback + 1)
    : addDays(today, -Math.max(lookback, 30));
  return { start, endExclusive: nextDay(today) };
}

function addMonths(isoDate: string, months: number): string {
  const [y, m] = isoDate.split('-').map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

function emptyStats(): ExtractStats {
  return { arHeads: 0, arLines: 0, recHeads: 0, recLines: 0, recSellers: 0, operators: 0 };
}

function addStats(a: ExtractStats, b: ExtractStats): ExtractStats {
  return {
    arHeads: a.arHeads + b.arHeads,
    arLines: a.arLines + b.arLines,
    recHeads: a.recHeads + b.recHeads,
    recLines: a.recLines + b.recLines,
    recSellers: a.recSellers + b.recSellers,
    operators: a.operators + b.operators,
  };
}

/**
 * 部署全量 / 夜间校对的日期范围：
 * - 优先 U9_ETL_FULL_SINCE
 * - 否则取 U9 应收/收款头表最早 BusinessDate（单表 MIN）
 */
export async function fullSyncRange(today: string): Promise<{ start: string; endExclusive: string }> {
  const configured = config.u9Mirror.fullSince;
  let start = configured;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    const [arMin, recMin] = await Promise.all([
      raw.fetchMinArBusinessDate(),
      raw.fetchMinRecBusinessDate(),
    ]);
    const candidates = [arMin, recMin].filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d));
    start = candidates.sort()[0] || addDays(today, -365);
  }
  return { start, endExclusive: nextDay(today) };
}

/** 按自然月切片抽取，避免一次载入多年数据。 */
export async function extractDateRangeChunked(
  start: string,
  endExclusive: string
): Promise<ExtractStats> {
  let cursor = start.slice(0, 7) + '-01';
  if (cursor < start) cursor = start;
  let totals = emptyStats();
  let chunks = 0;
  while (cursor < endExclusive) {
    const monthEnd = addMonths(cursor.slice(0, 7) + '-01', 1);
    const chunkEnd = monthEnd < endExclusive ? monthEnd : endExclusive;
    const part = await extractBusinessDateWindow(cursor, chunkEnd);
    totals = addStats(totals, part);
    chunks += 1;
    console.log(`[u9-mirror] 全量切片 ${cursor} ~ ${chunkEnd}`, part);
    cursor = chunkEnd;
  }
  console.log(`[u9-mirror] 全量切片完成 chunks=${chunks}`, totals);
  return totals;
}

export { nextDay, addDays };
