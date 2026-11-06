import assert from 'node:assert/strict';
import test from 'node:test';
import { getPayrollPage } from '../src/modules/hr/payroll/payrollPagination';

test('分页显示指定页，并在末页记录减少后保留可用页', () => {
  const rows = Array.from({ length: 23 }, (_, index) => index + 1);
  assert.deepEqual(getPayrollPage(rows, 2, 10), { page: 2, items: rows.slice(10, 20) });
  assert.deepEqual(getPayrollPage(rows.slice(0, 10), 3, 10), { page: 1, items: rows.slice(0, 10) });
  assert.deepEqual(getPayrollPage([], 1, 10), { page: 1, items: [] });
});
