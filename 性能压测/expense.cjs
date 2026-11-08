require('./safety.cjs').requireIsolated(process.env, 'mysql');
require('./safety.cjs').requireIsolated(process.env, 'jwt');
if (process.env.PERF_SYNTHETIC_VERIFY !== 'yes') throw new Error('需要显式启用隔离库中的合成查验记录');
const assert = require('node:assert/strict');
const mysql = require('/app/server/node_modules/mysql2/promise');
const jwt = require('/app/server/node_modules/jsonwebtoken');
const count = Number(process.argv[2]);
const first = Number(process.argv[3]);
if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isInteger(first) || first < 1 || first + count > 101) throw new Error('测试人数或账号范围无效');
const invoice = i => ({ id: `test-invoice-${i}`, invoiceNumber: `99${String(i).padStart(18, '0')}`, invoiceCode: '', invoiceDate: '2026-11-01', invoiceType: 'synthetic', amount: 100, totalAmount: 100, checkCode: '', isMock: false });
async function main() {
  const db = await mysql.createConnection({ host: 'db', user: 'root', password: process.env.PERF_MYSQL_PASSWORD, database: 'yunqi_perf' });
  assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name, 'yunqi_perf');
  try {
    await db.query("INSERT INTO approval_approvers (type,employee_id,updated_by,updated_at) VALUES ('expense','T0001',1,NOW()) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id)");
    await db.query("INSERT INTO approval_rules (type,content,updated_by,updated_at) VALUES ('expense','Synthetic rule.',1,NOW()) ON DUPLICATE KEY UPDATE content=VALUES(content)");
    for (let i = first; i < first + count; i++) {
      const inv = invoice(i);
      // 模拟查验成功缓存，仅允许在独立测试库；不能代表真实查验结果。
      await db.query("INSERT INTO invoice_verifications (invoice_key,status,message,invoice_json,mock,verified_at) VALUES (?,'valid','synthetic',?,0,NOW())", [inv.invoiceNumber, JSON.stringify(inv)]);
    }
    const elapsed = [], failures = [], approvals = [];
    await Promise.all(Array.from({ length: count }, async (_, k) => {
      const i = first + k, employee = `T${String(i).padStart(4, '0')}`;
      const token = jwt.sign({ typ: 'access', sv: 0 }, process.env.PERF_JWT_SECRET, { subject: employee, expiresIn: '1h' });
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const payload = { type: 'expense', title: 'synthetic expense', form: [{ label: '说明', value: 'test' }], invoices: [invoice(i)] };
      const start = performance.now();
      try {
        const preview = await fetch('http://app:3000/api/approvals/expense-precheck/stream', { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
        assert.ok(preview.ok, `precheck http-${preview.status}`);
        const stream = await preview.text();
        const result = stream.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'result');
        assert.equal(result?.status, 'completed', '预审未完成');
        const submit = await fetch('http://app:3000/api/approvals', { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
        const body = await submit.json();
        assert.ok(submit.ok && body.code === 0 && body.data?.id, `submit http-${submit.status}`);
        approvals.push(body.data.id);
      } catch (error) { failures.push(`${employee}: ${error.message}`); }
      elapsed.push(performance.now() - start);
    }));
    elapsed.sort((a, b) => a - b);
    const begin = performance.now();
    let completed = 0;
    while (approvals.length && performance.now() - begin < 120000) {
      const [rows] = await db.query("SELECT COUNT(*) completed FROM expense_ai_jobs WHERE approval_id IN (?) AND status='completed'", [approvals]);
      completed = rows[0].completed;
      if (completed === approvals.length) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log(JSON.stringify({ count, failed: failures.length, failures, p50: Math.round(elapsed[Math.ceil(count * .5) - 1]), p95: Math.round(elapsed[Math.ceil(count * .95) - 1]), submitted: approvals.length, completed, jobWaitMs: Math.round(performance.now() - begin) }));
    if (failures.length || completed !== approvals.length) process.exitCode = 1;
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
