require('./safety.cjs').requireIsolated(process.env, 'mysql');
const mysql = require('/app/server/node_modules/mysql2/promise');
const duration = Number(process.argv[2]);
if (!Number.isFinite(duration) || duration < 5000 || duration > 1900000) throw new Error('无效采样时长');
async function main() {
  const db = await mysql.createConnection({ host: 'db', user: 'root', password: process.env.PERF_MYSQL_PASSWORD, database: 'yunqi_perf' });
  if ((await db.query('SELECT DATABASE() AS name'))[0][0].name !== 'yunqi_perf') throw new Error('数据库不是隔离测试库');
  const start = performance.now();
  try {
    while (performance.now() - start < duration) {
      const [values] = await db.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Innodb_row_lock_current_waits','Innodb_row_lock_time','Innodb_row_lock_waits','Queries','Connections')");
      const [locks] = await db.query('SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits');
      console.log(JSON.stringify({ timeUtc:new Date().toISOString(), sinceMs:Math.round(performance.now()-start), lockWaitsNow:locks[0].n, status:Object.fromEntries(values.map(row=>[row.Variable_name,Number(row.Value)])) }));
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
  } finally { await db.end(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
