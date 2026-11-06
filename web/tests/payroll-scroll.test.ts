import assert from 'node:assert/strict';
import test from 'node:test';
import { connectPayrollScroll } from '../src/modules/hr/payroll/payrollScroll';

class ScrollElement extends EventTarget {
  scrollLeft = 0;
}

test('工资表与底部滚动条双向同步，解绑后不再同步', () => {
  const table = new ScrollElement();
  const bar = new ScrollElement();
  table.scrollLeft = 80;
  const disconnect = connectPayrollScroll(table, bar);
  assert.equal(bar.scrollLeft, 80);
  bar.scrollLeft = 180;
  bar.dispatchEvent(new Event('scroll'));
  assert.equal(table.scrollLeft, 180);
  table.scrollLeft = 45;
  table.dispatchEvent(new Event('scroll'));
  assert.equal(bar.scrollLeft, 45);
  disconnect();
  bar.scrollLeft = 100;
  bar.dispatchEvent(new Event('scroll'));
  assert.equal(table.scrollLeft, 45);
});
