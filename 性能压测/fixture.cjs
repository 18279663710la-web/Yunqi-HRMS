require('./safety.cjs').requireIsolated(process.env, 'mysql');
const mysql = require('/app/server/node_modules/mysql2/promise');
const PDFDocument = require('/app/server/node_modules/pdfkit');
const { hashPassword } = require('/app/server/dist/shared/utils/password');
async function main() {
  const db = await mysql.createConnection({host:'db', user:'root', password:process.env.PERF_MYSQL_PASSWORD, database:'yunqi_perf', dateStrings:true});
  const [identity] = await db.query('SELECT DATABASE() AS name');
  if (identity[0].name !== 'yunqi_perf') throw new Error('wrong isolated database');
  const hash = hashPassword('synthetic-password');
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const pdfDone = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(14).text('SYNTHETIC TEST PAYSLIP - NO REAL DATA');
  for (let i = 0; i < 100; i++) doc.fontSize(8).text(`Synthetic test value ${i}: 0.00`);
  doc.end();
  const pdf = await pdfDone;
  await db.beginTransaction();
  try {
    await db.query("INSERT INTO attendance_settings (id,start_time,in_end_time,end_time,out_end_time,rest_dates,address,floor,latitude,longitude,radius) VALUES (1,'00:00','23:58','23:59','23:59',JSON_ARRAY(),'test','',23.1,113.3,100) ON DUPLICATE KEY UPDATE start_time=VALUES(start_time),in_end_time=VALUES(in_end_time),end_time=VALUES(end_time),out_end_time=VALUES(out_end_time),rest_dates=VALUES(rest_dates),latitude=VALUES(latitude),longitude=VALUES(longitude),radius=VALUES(radius)");
    const [batch] = await db.query("INSERT INTO hr_payroll_batches (payroll_month,status,created_at) VALUES ('2026-10','reviewed',NOW())");
    const attendance=[];
    for (let i=1;i<=100;i++) {
      const id=`T${String(i).padStart(4,'0')}`;
      await db.query("INSERT INTO employees (id,name,pinyin,dept_id,position,job_category,level,employee_no,phone,email,join_date,is_leader,seat) VALUES (?,?,?,'D00','员工','员工','',?,'','','2024-01-01',0,'')",[id,`test${i}`,`test${i}`,`test${i}`]);
      await db.query("INSERT INTO employee_accounts (employee_id,login_name,password_hash,status,created_at,updated_at) VALUES (?,?,?,'active',NOW(),NOW())",[id,`test${i}`,hash]);
      for(let d=1;d<=30;d++) attendance.push([id,new Date(Date.now()-d*86400000).toISOString().slice(0,10),'09:00','18:00','employee',new Date(),new Date()]);
      const [item]=await db.query("INSERT INTO hr_payroll_batch_items (batch_id,employee_id,gross,deductions,net,note) VALUES (?,?,0,0,0,'')",[batch.insertId,id]);
      await db.query('INSERT INTO hr_payroll_payslips (batch_id,item_id,employee_id,pdf_data,revision,sent_at,sent_by) VALUES (?,?,?,?,1,NOW(),1)',[batch.insertId,item.insertId,id,pdf]);
    }
    await db.query('INSERT INTO attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES ?', [attendance]);
    await db.commit();
    console.log(JSON.stringify({employees:100,historyRows:attendance.length,pdfBytes:pdf.length,batchId:batch.insertId}));
  } catch (e) {await db.rollback(); throw e;} finally {await db.end();}
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
