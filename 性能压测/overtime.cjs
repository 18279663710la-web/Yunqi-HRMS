require('./safety.cjs').requireIsolated(process.env, 'mysql');
require('./safety.cjs').requireIsolated(process.env, 'jwt');
const assert = require('node:assert/strict');
const mysql = require('/app/server/node_modules/mysql2/promise');
const jwt = require('/app/server/node_modules/jsonwebtoken');
const count = Number(process.argv[2]);
const first = Number(process.argv[3]);
if (!Number.isInteger(count) || count < 1 || count > 20 || !Number.isInteger(first) || first < 1 || first + count > 101) throw new Error('测试人数或账号范围无效');
const base = 'http://app:3000/api';
const employeeId = i => `T${String(i).padStart(4, '0')}`;
const approvalId = i => `OVTEST${String(i).padStart(4, '0')}`;
async function main() {
  const db = await mysql.createConnection({ host: 'db', user: 'root', password: process.env.PERF_MYSQL_PASSWORD, database: 'yunqi_perf', dateStrings: true });
  assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name, 'yunqi_perf');
  try {
    const [date] = await db.query('SELECT DATE_FORMAT(DATE_SUB(CURDATE(),INTERVAL 1 DAY),\'%Y-%m-%d\') AS previous');
    const form = JSON.stringify([{ label: '加班日期', value: date[0].previous }, { label: '开始时间', value: '00:00' }, { label: '结束时间', value: '01:00' }, { label: '补偿方式', value: '加班费' }]);
    for (let i = first; i < first + count; i++) await db.query("INSERT INTO approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES (?,'overtime','test','synthetic overtime','approved',?,'test','test','员工',?,NOW())", [approvalId(i), employeeId(i), form]);
    async function punch(type) {
      const times = [], failures = [];
      await Promise.all(Array.from({ length: count }, async (_, k) => {
        const i = first + k, token = jwt.sign({ typ: 'access', sv: 0 }, process.env.PERF_JWT_SECRET, { subject: employeeId(i), expiresIn: '1h' });
        const start = performance.now();
        try {
          const response = await fetch(`${base}/attendance/overtime/punch`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalId: approvalId(i), type, latitude: 23.1, longitude: 113.3, accuracy: 10 }), signal: AbortSignal.timeout(15000) });
          const body = await response.json(); assert.ok(response.ok && body.code === 0 && body.data?.ok === true, body.data?.message || body.message);
        } catch (error) { failures.push(`${employeeId(i)}: ${error.message}`); }
        times.push(performance.now() - start);
      }));
      times.sort((a, b) => a - b);
      return { failed: failures.length, failures, p50: Math.round(times[Math.ceil(count * .5) - 1]), p95: Math.round(times[Math.ceil(count * .95) - 1]) };
    }
    const startResult = await punch('in');
    const ids = Array.from({ length: count }, (_, i) => approvalId(first + i));
    // 只在隔离测试库中回拨打卡行，模拟前一天 23:30 上班、今天下班。
    await db.query("UPDATE attendance_overtime_punches SET check_in=CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY),' 23:30:00') WHERE approval_id IN (?)", [ids]);
    const endResult = await punch('out');
    const [rows] = await db.query('SELECT COUNT(*) total, COUNT(check_out) completed, SUM(DATE(check_in)<DATE(check_out)) cross_day FROM attendance_overtime_punches WHERE approval_id IN (?)', [ids]);
    console.log(JSON.stringify({ count, start: startResult, end: endResult, database: rows[0] }));
    if (startResult.failed || endResult.failed || rows[0].completed !== count || Number(rows[0].cross_day) !== count) process.exitCode = 1;
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
