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

export { nextDay, addDays };
