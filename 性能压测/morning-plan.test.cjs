const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateRoles, percentile, isBusinessSuccess, plannedActions, boundedWait, summarizeSamples } = require('./morning-plan.cjs');

test('50 人和 100 人的角色分配包含对应数量的员工与管理员', () => {
  assert.deepEqual(allocateRoles(50), { punch: 30, workbench: 8, approval: 5, browse: 5, admin: 2 });
  assert.deepEqual(allocateRoles(100), { punch: 60, workbench: 15, approval: 10, browse: 10, admin: 5 });
  assert.throws(() => allocateRoles(51));
});

test('业务返回失败或 HTTP 错误不能计为成功', () => {
  assert.equal(isBusinessSuccess(200, { code: 0, data: { ok: true } }, true), true);
  assert.equal(isBusinessSuccess(200, { code: 0, data: { ok: false } }, true), false);
  assert.equal(isBusinessSuccess(500, { code: 0 }, false), false);
  assert.equal(isBusinessSuccess(200, { code: 409 }, false), false);
  assert.equal(isBusinessSuccess(200, { code: 0, data: null }, false), true);
});

test('百分位使用最近秩且空样本不产生虚假值', () => {
  assert.equal(percentile([], .95), null);
  assert.equal(percentile([4, 1, 2, 3], .5), 2);
  assert.equal(percentile([4, 1, 2, 3], .95), 4);
});

test('持续使用包含有限、分散的操作，非每轮重复提交打卡和审批', () => {
  assert.deepEqual(plannedActions('punch', 0), ['punch']);
  assert.ok(!plannedActions('punch', 1).includes('punch'));
  assert.ok(!plannedActions('approval', 1).includes('submit'));
  assert.ok(plannedActions('admin', 1).includes('dashboard'));
});

test('周期等待不能超过压测截止时间', () => {
  assert.equal(boundedWait(15000, 1800000, 1799990), 10);
  assert.equal(boundedWait(15000, 1800000, 1800001), 0);
  assert.equal(boundedWait(15000, 1800000, 1000), 15000);
});

test('时间片统计同时保留失败数和延迟', () => {
  assert.deepEqual(summarizeSamples([10, 20, 30], 1), { count:3, failed:1, p50:20, p95:30, p99:30, max:30 });
});
