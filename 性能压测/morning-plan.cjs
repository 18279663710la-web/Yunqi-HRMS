function allocateRoles(users) {
  if (users === 50) return { punch: 30, workbench: 8, approval: 5, browse: 5, admin: 2 };
  if (users === 100) return { punch: 60, workbench: 15, approval: 10, browse: 10, admin: 5 };
  throw new Error('仅支持 50 或 100 个模拟用户');
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 10) / 10;
}
function isBusinessSuccess(status, body, requireOk) {
  return status >= 200 && status < 300 && body?.code === 0 && (!requireOk || body.data?.ok === true);
}
function plannedActions(role, cycle) {
  if (cycle === 0) return ({ punch: ['punch'], workbench: ['workbench'], approval: ['submit'], browse: ['browse'], admin: ['dashboard'] })[role] || [];
  return ({ punch: ['status'], workbench: ['workbench'], approval: ['approval'], browse: ['browse'], admin: ['dashboard'] })[role] || [];
}
function boundedWait(interval, deadline, elapsed) { return Math.max(0, Math.min(interval, deadline - elapsed)); }
function summarizeSamples(durations, failed) { return { count:durations.length, failed, p50:percentile(durations,.5), p95:percentile(durations,.95), p99:percentile(durations,.99), max:percentile(durations,1) }; }
module.exports = { allocateRoles, percentile, isBusinessSuccess, plannedActions, boundedWait, summarizeSamples };
