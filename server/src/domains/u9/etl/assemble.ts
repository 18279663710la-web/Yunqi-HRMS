import { formatMoney } from '../money';
import type { RawRow } from './u9RawQueries';

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  return String(v);
}

function mapById(rows: RawRow[]): Map<string, RawRow> {
  return new Map(rows.map((row) => [str(row.id), row]));
}

export interface AssembledOperator {
  id: string;
  code: string;
  name: string;
  orgId: string;
  orgName: string;
}

export interface AssembledArHead {
  id: string;
  docNo: string;
  customerId: string;
  customerName: string;
  businessDate: string;
  postPeriod: string;
  srcOrg: string;
  invoiceDate: string | null;
  invoiceNum: string;
  currencyName: string;
  currencyPrecision: number;
  docStatus: number;
}

export interface AssembledArLine {
  id: string;
  docId: string;
  sellerOperatorId: string;
  lineNum: number;
  srcShipNo: string;
  srcLineNum: number;
  itemName: string;
  itemCode: string;
  uom: string;
  qty: string;
  nonTaxPrice: string;
  taxPrice: string;
  nonTaxAmount: string;
  taxAmount: string;
  taxIncludedTotal: string;
  totalAmount: string;
  totalBalance: string;
  ownAmount: string;
  bizOrg: string;
  maturity: string | null;
  lineStatus: string;
}

export interface AssembledRecHead {
  id: string;
  docNo: string;
  customerId: string;
  customerName: string;
  businessDate: string;
  postPeriod: string;
  orgId: string;
  orgCode: string;
  orgName: string;
  transactorId: string;
  totalAmount: string;
  currencyName: string;
  currencyPrecision: number;
  docStatus: number;
}

export interface AssembledRecLine {
  id: string;
  docId: string;
  lineNum: number;
  settlementMethod: string;
  noteNo: string;
  amount: string;
  bankAccount: string;
}

export interface AssembledRecSeller {
  docId: string;
  sellerOperatorId: string;
  ownAmount: string;
}

export interface AssembleArInput {
  heads: RawRow[];
  lines: RawRow[];
  shipLines: RawRow[];
  ships: RawRow[];
  customers: RawRow[];
  periods: RawRow[];
  orgs: RawRow[];
  currencies: RawRow[];
  currencyTrls: RawRow[];
  uoms: RawRow[];
}

export interface AssembleArResult {
  heads: AssembledArHead[];
  lines: AssembledArLine[];
}

/** 按现网口径过滤：头未取消且 DocStatus>1、出货未取消、有业务员归属。 */
export function assembleArDocuments(input: AssembleArInput): AssembleArResult {
  const customers = mapById(input.customers);
  const periods = mapById(input.periods);
  const orgs = mapById(input.orgs);
  const currencies = mapById(input.currencies);
  const currencyTrls = mapById(input.currencyTrls);
  const uoms = mapById(input.uoms);
  const shipLines = mapById(input.shipLines);
  const ships = mapById(input.ships);

  const validHeads = input.heads.filter(
    (h) => Number(h.cancelCanceled) === 0 && Number(h.docStatus) > 1
  );
  const headMap = mapById(validHeads);
  const lines: AssembledArLine[] = [];

  for (const line of input.lines) {
    const docId = str(line.docId);
    if (!headMap.has(docId)) continue;
    const shipLine = shipLines.get(str(line.srcShipLineId));
    if (!shipLine) continue;
    const ship = ships.get(str(shipLine.shipId));
    if (!ship || Number(ship.cancelCanceled) !== 0) continue;
    const seller = str(shipLine.sellerId);
    if (!seller || seller === '0') continue;
    const head = headMap.get(docId)!;
    const precision = Number(currencies.get(str(head.currencyId))?.moneyPrecision ?? 2);
    const own = formatMoney(line.taxIncludedTotal, precision);
    lines.push({
      id: str(line.id),
      docId,
      sellerOperatorId: seller,
      lineNum: Number(line.lineNum),
      srcShipNo: str(ship.docNo, '-'),
      srcLineNum: Number(shipLine.docLineNo),
      itemName: str(line.itemName, '-'),
      itemCode: str(line.itemCode, '-'),
      uom: str(uoms.get(str(line.uomId))?.name, '-'),
      qty: formatMoney(line.qty, 4),
      nonTaxPrice: formatMoney(line.nonTaxPrice, 4),
      taxPrice: formatMoney(line.taxPrice, 4),
      nonTaxAmount: formatMoney(line.nonTaxAmount, precision),
      taxAmount: formatMoney(line.taxAmount, precision),
      taxIncludedTotal: own,
      totalAmount: formatMoney(line.totalAmount, precision),
      totalBalance: formatMoney(line.totalBalance, precision),
      ownAmount: own,
      bizOrg: str(orgs.get(str(line.bizOrgId))?.name, '-'),
      maturity: line.maturity ? str(line.maturity) : null,
      lineStatus: Number(line.redFlushStatus) === -1 && !line.isRedFlush ? '' : '红冲',
    });
  }

  const usedDocIds = new Set(lines.map((l) => l.docId));
  const heads: AssembledArHead[] = validHeads
    .filter((h) => usedDocIds.has(str(h.id)))
    .map((h) => {
      const currencyId = str(h.currencyId);
      return {
        id: str(h.id),
        docNo: str(h.docNo),
        customerId: str(h.customerId),
        customerName: str(customers.get(str(h.customerId))?.name, '-'),
        businessDate: str(h.businessDate),
        postPeriod: str(periods.get(str(h.postPeriodId))?.displayName),
        srcOrg: str(orgs.get(str(h.srcOrgId))?.name, '-'),
        invoiceDate: h.invoiceDate ? str(h.invoiceDate) : null,
        invoiceNum: str(h.invoiceNum),
        currencyName: str(currencyTrls.get(currencyId)?.name),
        currencyPrecision: Number(currencies.get(currencyId)?.moneyPrecision ?? 2),
        docStatus: Number(h.docStatus),
      };
    });

  return { heads, lines };
}

export interface AssembleRecInput {
  heads: RawRow[];
  lines: RawRow[];
  lineTrls: RawRow[];
  applyLines: RawRow[];
  arLines: RawRow[];
  shipLines: RawRow[];
  ships: RawRow[];
  customers: RawRow[];
  periods: RawRow[];
  orgs: RawRow[];
  orgCodes: RawRow[];
  currencies: RawRow[];
  currencyTrls: RawRow[];
  settlements: RawRow[];
  banks: RawRow[];
}

export interface AssembleRecResult {
  heads: AssembledRecHead[];
  lines: AssembledRecLine[];
  sellers: AssembledRecSeller[];
}

export function assembleRecDocuments(input: AssembleRecInput): AssembleRecResult {
  const customers = mapById(input.customers);
  const periods = mapById(input.periods);
  const orgs = mapById(input.orgs);
  const orgCodes = mapById(input.orgCodes);
  const currencies = mapById(input.currencies);
  const currencyTrls = mapById(input.currencyTrls);
  const settlements = mapById(input.settlements);
  const banks = mapById(input.banks);
  const lineTrls = mapById(input.lineTrls);
  const shipLines = mapById(input.shipLines);
  const ships = mapById(input.ships);
  const arLines = mapById(input.arLines);

  const validHeads = input.heads.filter(
    (h) => Number(h.cancelCanceled) === 0 && Number(h.docStatus) > 1
  );
  const headMap = mapById(validHeads);

  const sellerAmounts = new Map<string, Map<string, number>>();
  for (const apply of input.applyLines) {
    const recId = str(apply.recHeadId);
    if (!headMap.has(recId)) continue;
    const arLine = arLines.get(str(apply.arLineId));
    if (!arLine) continue;
    const shipLine = shipLines.get(str(arLine.srcShipLineId));
    if (!shipLine) continue;
    const ship = ships.get(str(shipLine.shipId));
    if (!ship || Number(ship.cancelCanceled) !== 0) continue;
    const seller = str(shipLine.sellerId);
    if (!seller || seller === '0') continue;
    const amount = Number(apply.applyAmount) || 0;
    let bySeller = sellerAmounts.get(recId);
    if (!bySeller) {
      bySeller = new Map();
      sellerAmounts.set(recId, bySeller);
    }
    bySeller.set(seller, (bySeller.get(seller) || 0) + amount);
  }

  const sellers: AssembledRecSeller[] = [];
  for (const [docId, bySeller] of sellerAmounts) {
    for (const [sellerOperatorId, amount] of bySeller) {
      sellers.push({
        docId,
        sellerOperatorId,
        ownAmount: formatMoney(amount, 2),
      });
    }
  }

  const used = new Set(sellers.map((s) => s.docId));
  const heads: AssembledRecHead[] = validHeads
    .filter((h) => used.has(str(h.id)))
    .map((h) => {
      const currencyId = str(h.currencyId);
      const orgId = str(h.orgId);
      const customerId = str(h.customerId);
      return {
        id: str(h.id),
        docNo: str(h.docNo),
        customerId,
        customerName: str(
          customers.get(customerId)?.name,
          str(h.custShortName, str(h.custCode, '-'))
        ),
        businessDate: str(h.businessDate),
        postPeriod: str(periods.get(str(h.postPeriodId))?.displayName),
        orgId,
        orgCode: str(orgCodes.get(orgId)?.code),
        orgName: str(orgs.get(orgId)?.name),
        transactorId: str(h.transactorId),
        totalAmount: formatMoney(h.totalAmount, Number(currencies.get(currencyId)?.moneyPrecision ?? 2)),
        currencyName: str(currencyTrls.get(currencyId)?.name),
        currencyPrecision: Number(currencies.get(currencyId)?.moneyPrecision ?? 2),
        docStatus: Number(h.docStatus),
      };
    });

  const lines: AssembledRecLine[] = input.lines
    .filter((l) => used.has(str(l.docId)))
    .map((l) => ({
      id: str(l.id),
      docId: str(l.docId),
      lineNum: Number(l.lineNum),
      settlementMethod: str(settlements.get(str(l.settlementMethodId))?.name, '-'),
      noteNo: str(lineTrls.get(str(l.id))?.noteNo, '-'),
      amount: formatMoney(l.amount, 2),
      bankAccount: str(banks.get(str(l.bankAccountId))?.name, str(l.recBkAccName, '-')),
    }));

  return { heads, lines, sellers };
}

export function assembleOperators(
  operators: RawRow[],
  trls: RawRow[],
  orgTrls: RawRow[]
): AssembledOperator[] {
  const names = mapById(trls);
  const orgs = mapById(orgTrls);
  return operators.map((o) => ({
    id: str(o.id),
    code: str(o.code),
    name: str(names.get(str(o.id))?.name),
    orgId: str(o.orgId),
    orgName: str(orgs.get(str(o.orgId))?.name),
  }));
}
