import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAndIssuePayroll } from '../src/modules/hr/payroll/payrollIssuePayslips';
import type { DisbursementState, PayrollBatch, PayrollBatchItem, SalaryComponentModel } from '../src/modules/hr/api';

const batch: PayrollBatch = { id: 1, month: '2026-10', status: 'reviewed', createdAt: '', reviewedAt: '' };
const model: SalaryComponentModel = { version: 1, fixedFields: [{ name: '姓名', type: 'text', required: true }, { name: '员工号', type: 'text', required: true }, { name: '职务', type: 'text', required: true }], extendedFields: [] };
const item = (id: number): PayrollBatchItem => ({ id, employeeId: `U${id}`, name: `员工${id}`, employeeNo: `E${id}`, position: '岗位', gross: id * 100, baseGross: 0, attendanceRate: null, attendanceAdjustment: 0, overtimeSeconds: 0, overtimePay: 0, deductions: 0, net: 0, note: '', modelSnapshot: null });
const items = [item(1), item(2)];
const state: DisbursementState = { revision: 'revision', fields: [], rows: items.map(row => ({ itemId: row.id, net: row.gross, values: [] })) };

test('为每个员工准备单人工资条后才执行发放', async () => {
  const staged: Array<[number, string]> = [];
  const generated: string[][] = [];
  let issued = 0;
  const result = await prepareAndIssuePayroll(batch, items, model, state, {
    generate: async data => { assert.equal(data.showTotals, false); generated.push(data.rows.map(row => String(row[0]))); return `pdf${data.rows[0][0]}`; },
    stage: async (_batch, itemId, _revision, pdf) => { staged.push([itemId, pdf]); },
    issue: async () => { assert.equal(staged.length, 2); issued++; return { id: 9 }; },
  });
  assert.deepEqual(generated, [['员工1'], ['员工2']]);
  assert.deepEqual(staged, [[1, 'pdf员工1'], [2, 'pdf员工2']]);
  assert.equal(issued, 1); assert.equal(result.id, 9);
});

test('准备任一工资条失败时不执行发放', async () => {
  let issued = false;
  await assert.rejects(prepareAndIssuePayroll(batch, items, model, state, {
    generate: async () => 'pdf',
    stage: async (_batch, itemId) => { if (itemId === 2) throw new Error('上传失败'); },
    issue: async () => { issued = true; return { id: 9 }; },
  }), /上传失败/);
  assert.equal(issued, false);
});
