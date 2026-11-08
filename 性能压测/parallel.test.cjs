const test = require('node:test');
const assert = require('node:assert/strict');
const { allOrFail } = require('./parallel.cjs');

test('并行请求发生失败时，等待其余请求结束后再汇总', async () => {
  let completed = false;
  const other = new Promise(resolve => setTimeout(() => { completed = true; resolve('ok'); }, 10));
  await assert.rejects(allOrFail([Promise.reject(new Error('failed')), other]), /failed/);
  assert.equal(completed, true);
});

test('并行请求成功时按原顺序返回结果', async () => {
  assert.deepEqual(await allOrFail([Promise.resolve('first'), Promise.resolve('second')]), ['first', 'second']);
});
