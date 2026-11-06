import assert from 'node:assert/strict';
import test from 'node:test';
import { readDisbursementPosition, rememberDisbursementBatch, rememberDisbursementScroll, clearDisbursementPosition } from '../src/modules/hr/payroll/disbursementPosition';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

test('批次与滚动位置在页面刷新后恢复，重新选择同一批次保留位置', () => {
  const storage = memoryStorage();
  rememberDisbursementBatch(storage, '2026-10', 42);
  rememberDisbursementScroll(storage, 42, 580);
  assert.deepEqual(readDisbursementPosition(storage), { month: '2026-10', batchId: 42, scrollLeft: 580 });
  rememberDisbursementBatch(storage, '2026-10', 42);
  assert.equal(readDisbursementPosition(storage)?.scrollLeft, 580);
});

test('不同批次不继承旧位置，过时的滚动事件不能覆盖新选择', () => {
  const storage = memoryStorage();
  rememberDisbursementBatch(storage, '2026-10', 42);
  rememberDisbursementScroll(storage, 42, 580);
  rememberDisbursementBatch(storage, '2026-11', 43);
  rememberDisbursementScroll(storage, 42, 900);
  assert.deepEqual(readDisbursementPosition(storage), { month: '2026-11', batchId: 43, scrollLeft: 0 });
  clearDisbursementPosition(storage);
  assert.equal(readDisbursementPosition(storage), undefined);
});

test('无效数据或浏览器存储不可用时不会阻止页面使用', () => {
  const broken = { getItem: () => { throw new Error('storage disabled'); }, setItem: () => { throw new Error('storage disabled'); }, removeItem: () => { throw new Error('storage disabled'); } };
  assert.doesNotThrow(() => rememberDisbursementBatch(broken, '2026-10', 42));
  assert.equal(readDisbursementPosition(broken), undefined);
  const corrupt = memoryStorage();
  corrupt.setItem('payroll-disbursement-position-v1', '{invalid');
  assert.equal(readDisbursementPosition(corrupt), undefined);
});
