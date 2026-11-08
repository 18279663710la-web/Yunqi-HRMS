function requireIsolated(env, credential) {
  if (env.PERF_ISOLATED !== 'yes') throw new Error('压测仅允许在明确标记的隔离环境中运行');
  const key = credential === 'mysql' ? 'PERF_MYSQL_PASSWORD' : 'PERF_JWT_SECRET';
  if (!env[key] || env[key].length < 8) throw new Error('缺少测试环境凭据');
}

module.exports = { requireIsolated };
