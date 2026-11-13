import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleArDocuments, assembleRecDocuments } from '../src/domains/u9/etl/assemble';

test('应收分查拼接：仅保留出货业务员归属且未取消单据', () => {
  const result = assembleArDocuments({
    heads: [
      {
        id: '10', docNo: 'AR-1', customerId: 'C1', businessDate: '2026-09-01', postPeriodId: 'P1',
        srcOrgId: 'O1', invoiceDate: '2026-09-02', invoiceNum: 'INV', currencyId: '1',
        docStatus: 2, cancelCanceled: 0,
      },
      {
        id: '11', docNo: 'AR-X', customerId: 'C1', businessDate: '2026-09-01', postPeriodId: 'P1',
        srcOrgId: 'O1', invoiceDate: null, invoiceNum: '', currencyId: '1',
        docStatus: 1, cancelCanceled: 0,
      },
    ],
    lines: [
      {
        id: 'L1', docId: '10', lineNum: 10, srcShipLineId: 'SL1', srcShipId: 'S1',
        itemName: '料', itemCode: 'A', uomId: 'U1', qty: '1', nonTaxPrice: '1', taxPrice: '1.13',
        nonTaxAmount: '1', taxAmount: '0.13', taxIncludedTotal: '1.13', totalAmount: '1.13',
        totalBalance: '1.13', bizOrgId: 'O1', maturity: '2026-10-01', redFlushStatus: -1, isRedFlush: 0,
      },
    ],
    shipLines: [{ id: 'SL1', shipId: 'S1', docLineNo: 10, sellerId: '101' }],
    ships: [{ id: 'S1', docNo: 'SM-1', cancelCanceled: 0 }],
    customers: [{ id: 'C1', name: '客户甲' }],
    periods: [{ id: 'P1', displayName: '2026-09' }],
    orgs: [{ id: 'O1', name: '一部' }],
    currencies: [{ id: '1', moneyPrecision: 2 }],
    currencyTrls: [{ id: '1', name: '人民币' }],
    uoms: [{ id: 'U1', name: 'KG' }],
  });

  assert.equal(result.heads.length, 1);
  assert.equal(result.heads[0].docNo, 'AR-1');
  assert.equal(result.heads[0].customerName, '客户甲');
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].sellerOperatorId, '101');
  assert.equal(result.lines[0].srcShipNo, 'SM-1');
  assert.equal(result.lines[0].lineStatus, '');
});

test('收款分查拼接：按核销出货业务员生成归属金额', () => {
  const result = assembleRecDocuments({
    heads: [
      {
        id: 'R1', docNo: 'REC-1', customerId: 'C1', custShortName: '', custCode: '',
        businessDate: '2026-09-15', postPeriodId: 'P1', orgId: 'O1', transactorId: '101',
        totalAmount: '100.00', currencyId: '1', docStatus: 2, cancelCanceled: 0,
      },
    ],
    lines: [
      {
        id: 'RL1', docId: 'R1', lineNum: 10, settlementMethodId: 'SM1', amount: '100.00',
        bankAccountId: 'B1', recBkAccName: '',
      },
    ],
    lineTrls: [{ id: 'RL1', noteNo: 'N1' }],
    applyLines: [
      { id: 'AP1', recHeadId: 'R1', recUseLineId: 'U1', arHeadId: '10', arLineId: 'L1', applyAmount: '60' },
      { id: 'AP2', recHeadId: 'R1', recUseLineId: 'U1', arHeadId: '10', arLineId: 'L2', applyAmount: '40' },
    ],
    arLines: [
      { id: 'L1', docId: '10', srcShipLineId: 'SL1', srcShipId: 'S1' },
      { id: 'L2', docId: '10', srcShipLineId: 'SL2', srcShipId: 'S1' },
    ],
    shipLines: [
      { id: 'SL1', shipId: 'S1', sellerId: '101', docLineNo: 10 },
      { id: 'SL2', shipId: 'S1', sellerId: '102', docLineNo: 20 },
    ],
    ships: [{ id: 'S1', docNo: 'SM-1', cancelCanceled: 0 }],
    customers: [{ id: 'C1', name: '客户甲' }],
    periods: [{ id: 'P1', displayName: '2026-09' }],
    orgs: [{ id: 'O1', name: '一部' }],
    orgCodes: [{ id: 'O1', code: '001' }],
    currencies: [{ id: '1', moneyPrecision: 2 }],
    currencyTrls: [{ id: '1', name: '人民币' }],
    settlements: [{ id: 'SM1', name: '票据' }],
    banks: [{ id: 'B1', name: '中国银行' }],
  });

  assert.equal(result.heads.length, 1);
  assert.equal(result.lines.length, 1);
  assert.equal(result.sellers.length, 2);
  const byOp = Object.fromEntries(result.sellers.map((s) => [s.sellerOperatorId, s.ownAmount]));
  assert.equal(byOp['101'], '60.00');
  assert.equal(byOp['102'], '40.00');
});
