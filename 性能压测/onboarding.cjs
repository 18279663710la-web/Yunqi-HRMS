require('./safety.cjs').requireIsolated(process.env, 'mysql');
require('./safety.cjs').requireIsolated(process.env, 'jwt');
const assert = require('node:assert/strict');
const mysql = require('/app/server/node_modules/mysql2/promise');
const jwt = require('/app/server/node_modules/jsonwebtoken');
const count = Number(process.argv[2]);
const first = Number(process.argv[3]);
if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isInteger(first) || first < 1 || first + count > 101) throw new Error('测试人数或账号范围无效');
const base = 'http://app:3000/api';
const makeId = i => `T${String(i).padStart(4, '0')}`;
async function main() {
  const db = await mysql.createConnection({ host: 'db', user: 'root', password: process.env.PERF_MYSQL_PASSWORD, database: 'yunqi_perf' });
  const [identity] = await db.query('SELECT DATABASE() AS name');
  assert.equal(identity[0].name, 'yunqi_perf');
  const template = JSON.stringify([{ name: '资料', type: 'attachment', required: true }]);
  try {
    for (let i = first; i < first + count; i++) await db.query('INSERT INTO hr_self_onboarding (employee_id,expected_date,template_json,created_at) VALUES (?,CURDATE(),?,NOW())', [makeId(i), template]);
    const times = [];
    const failures = [];
    await Promise.all(Array.from({ length: count }, async (_, k) => {
      const id = makeId(first + k);
      const auth = `Bearer ${jwt.sign({ typ: 'access', sv: 0 }, process.env.PERF_JWT_SECRET, { subject: id, expiresIn: '1h' })}`;
      const start = performance.now();
      try {
        const pending = await (await fetch(`${base}/onboarding-form/pending`, { headers: { Authorization: auth } })).json();
        assert.equal(pending.code, 0); assert.ok(pending.data?.id);
        const form = new FormData(); form.set('field', '资料'); form.set('file', new Blob([Buffer.alloc(262144)], { type: 'application/octet-stream' }), 'synthetic.bin');
        const response = await fetch(`${base}/onboarding-form/attachments`, { method: 'POST', headers: { Authorization: auth }, body: form, signal: AbortSignal.timeout(15000) });
        const upload = await response.json(); assert.equal(upload.code, 0); assert.ok(upload.data?.id);
        const result = await fetch(`${base}/onboarding-form/submit`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ __onboardingFormat: 2, values: { 资料: [upload.data] }, signature: 'data:image/png;base64,iVBORw0KGgo=', declarationAccepted: true }), signal: AbortSignal.timeout(15000) });
        const body = await result.json(); assert.equal(body.code, 0);
      } catch (error) { failures.push(`${id}: ${error.message}`); }
      times.push(performance.now() - start);
    }));
    const ids = Array.from({ length: count }, (_, i) => makeId(first + i));
    const [rows] = await db.query('SELECT COUNT(*) AS total, COUNT(submitted_at) AS submitted FROM hr_self_onboarding WHERE employee_id IN (?)', [ids]);
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ count, failed: failures.length, failures, p50: Math.round(times[Math.ceil(times.length * .5) - 1]), p95: Math.round(times[Math.ceil(times.length * .95) - 1]), total: rows[0].total, submitted: rows[0].submitted }));
    if (failures.length || rows[0].submitted !== count) process.exitCode = 1;
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
