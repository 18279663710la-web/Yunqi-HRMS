const test = require('node:test');
const assert = require('node:assert/strict');
const { requireIsolated } = require('./safety.cjs');

test('压测脚本只接受明确标记的隔离环境和必需的测试凭据', () => {
  assert.throws(() => requireIsolated({}, 'jwt'), /隔离/);
  assert.throws(() => requireIsolated({ PERF_ISOLATED: 'yes' }, 'jwt'), /凭据/);
  assert.throws(() => requireIsolated({ PERF_ISOLATED: 'yes' }, 'mysql'), /凭据/);
  assert.doesNotThrow(() => requireIsolated({ PERF_ISOLATED: 'yes', PERF_JWT_SECRET: 'test-only' }, 'jwt'));
  assert.doesNotThrow(() => requireIsolated({ PERF_ISOLATED: 'yes', PERF_MYSQL_PASSWORD: 'test-only' }, 'mysql'));
});
