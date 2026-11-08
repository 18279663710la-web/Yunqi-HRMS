require('./safety.cjs').requireIsolated(process.env, 'mysql');
require('./safety.cjs').requireIsolated(process.env, 'jwt');
if (process.env.PERF_U9_MOCK !== 'yes') throw new Error('必须明确启用隔离的 U9 网关替身');
const assert = require('node:assert/strict');
const mysql = require('/app/server/node_modules/mysql2/promise');
const jwt = require('/app/server/node_modules/jsonwebtoken');
const count = Number(process.argv[2]);
const first = Number(process.argv[3]);
if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isInteger(first) || first < 1 || first + count > 101) throw new Error('测试人数或账号范围无效');
async function main() {
  const db = await mysql.createConnection({ host: 'db', user: 'root', password: process.env.PERF_MYSQL_PASSWORD, database: 'yunqi_perf' });
  assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name, 'yunqi_perf');
  try {
    for (let i = first; i < first + count; i++) {
      const user = `T${String(i).padStart(4, '0')}`;
      await db.query("UPDATE employees SET position='业务员' WHERE id=?", [user]);
      await db.query('INSERT INTO u9_employee_bindings (employee_id,operator_id,updated_at) VALUES (?,?,NOW())', [user, String(8000 + i)]);
    }
    const times = [], failures = [];
    await Promise.all(Array.from({ length: count }, async (_, k) => {
      const i = first + k, user = `T${String(i).padStart(4, '0')}`, operator = String(8000 + i);
      const token = jwt.sign({ typ: 'access', sv: 0 }, process.env.PERF_JWT_SECRET, { subject: user, expiresIn: '1h' });
      const headers = { Authorization: `Bearer ${token}` }, start = performance.now();
      try {
        const response = await fetch('http://app:3000/api/business/receivables?page=1', { headers, signal: AbortSignal.timeout(15000) });
        const list = await response.json(); assert.ok(response.ok && list.code === 0 && list.data?.[0]?.id === operator);
        for (const path of [`/business/receivables/${operator}/pdf`, '/business/summary/pdf?from=2026-01&to=2026-11']) {
          const pdf = await fetch(`http://app:3000/api${path}`, { headers, signal: AbortSignal.timeout(15000) });
          const bytes = Buffer.from(await pdf.arrayBuffer()); assert.ok(pdf.ok && bytes.subarray(0, 4).toString() === '%PDF', `pdf http-${pdf.status}`);
        }
      } catch (error) { failures.push(`${user}: ${error.message}`); }
      times.push(performance.now() - start);
    }));
    times.sort((a, b) => a - b);
    const token = jwt.sign({ typ: 'access', sv: 0 }, process.env.PERF_JWT_SECRET, { subject: `T${String(first).padStart(4, '0')}`, expiresIn: '1h' });
    const other = await fetch(`http://app:3000/api/business/receivables/${8000 + first + 1}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    console.log(JSON.stringify({ count, failed: failures.length, failures, p50: Math.round(times[Math.ceil(count * .5) - 1]), p95: Math.round(times[Math.ceil(count * .95) - 1]), crossOperatorStatus: other.status }));
    if (failures.length || other.status !== 404) process.exitCode = 1;
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
