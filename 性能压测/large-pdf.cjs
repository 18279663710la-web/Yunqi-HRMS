require('./safety.cjs').requireIsolated(process.env, 'mysql');
const assert = require('node:assert/strict');
const mysql = require('/app/server/node_modules/mysql2/promise');
const PDFDocument = require('/app/server/node_modules/pdfkit');
async function main() {
  const db = await mysql.createConnection({ host: 'db', user: 'root', password: process.env.PERF_MYSQL_PASSWORD, database: 'yunqi_perf' });
  assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name, 'yunqi_perf');
  const pdf = new PDFDocument({ compress: false });
  const parts = [];
  pdf.on('data', part => parts.push(part));
  const done = new Promise(resolve => pdf.on('end', () => resolve(Buffer.concat(parts))));
  pdf.fontSize(10).text('SYNTHETIC LARGE TEST DOCUMENT');
  for (let i = 0; i < 1200; i++) pdf.text(`Synthetic test row ${i}: `.padEnd(90, '0'));
  pdf.end();
  const bytes = await done;
  assert.ok(bytes.subarray(0, 4).toString() === '%PDF' && bytes.length > 100000);
  try {
    const [result] = await db.query("UPDATE hr_payroll_payslips SET pdf_data=?, read_at=NULL WHERE employee_id REGEXP '^T[0-9]{4}$'", [bytes]);
    assert.equal(result.affectedRows, 100);
    console.log(JSON.stringify({ employees: result.affectedRows, pdfBytes: bytes.length }));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
