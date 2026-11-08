import assert from 'node:assert/strict';
import test from 'node:test';
import { getPayrollPage } from '../src/modules/hr/payroll/payrollPagination';

test('工资明细分页保留全部数据并在删除末页记录后回退', () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  assert.deepEqual(getPayrollPage(items, 1, 10), { page: 1, items: items.slice(0, 10) });
  assert.deepEqual(getPayrollPage(items, 2, 10), { page: 2, items: [11, 12] });
  assert.deepEqual(getPayrollPage(items.slice(0, 10), 2, 10), { page: 1, items: items.slice(0, 10) });
  assert.deepEqual(getPayrollPage([], 1, 10), { page: 1, items: [] });
});
