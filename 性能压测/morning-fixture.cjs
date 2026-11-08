require('./safety.cjs').requireIsolated(process.env, 'mysql');
const mysql = require('/app/server/node_modules/mysql2/promise');
const { hashPassword } = require('/app/server/dist/shared/utils/password');
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const employee = i => `T${String(i).padStart(4, '0')}`;
async function main() {
  const mode = process.argv[2];
  if (!['prepare', 'reset', 'audit'].includes(mode)) throw new Error('未知操作');
  const db = await mysql.createConnection({ host: 'db', user: 'root', password: process.env.PERF_MYSQL_PASSWORD, database: 'yunqi_perf' });
  if ((await db.query('SELECT DATABASE() AS name'))[0][0].name !== 'yunqi_perf') throw new Error('数据库不是隔离测试库');
  try {
    if (mode === 'prepare') {
      const form = JSON.stringify([{ label: '加班日期', value: day }, { label: '开始时间', value: '00:00' }, { label: '结束时间', value: '23:59' }, { label: '补偿方式', value: '加班费' }]);
      const hash = hashPassword('synthetic-admin-password');
      for (let i = 1; i <= 20; i++) await db.query("INSERT INTO approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES (?,'overtime','test','morning overtime','approved',?,'test','test','员工',?,NOW())", [`MOT${String(i).padStart(4, '0')}`, employee(i), form]);
      for (let i = 1; i <= 5; i++) await db.query("INSERT INTO admins (username,password_hash,name,role,status,created_at) VALUES (?,?,?,'super_admin',1,NOW())", [`morning_admin${i}`, hash, `test admin ${i}`]);
      for (const i of [...Array.from({ length: 5 }, (_, k) => k + 44), ...Array.from({ length: 10 }, (_, k) => k + 86)]) {
        await db.query("UPDATE employees SET position='业务员' WHERE id=?", [employee(i)]);
        await db.query('INSERT INTO u9_employee_bindings (employee_id,operator_id,updated_at) VALUES (?,?,NOW())', [employee(i), String(8000 + i)]);
      }
      const [admins] = await db.query("SELECT id FROM admins WHERE username LIKE 'morning_admin%' ORDER BY id");
      console.log(JSON.stringify({ mode, day, syntheticOvertime: 20, syntheticAdmins: admins.map(row => row.id), syntheticU9Bindings: 15 }));
    } else if (mode === 'reset') {
      const [punches] = await db.query("DELETE FROM attendance_punches WHERE employee_id REGEXP '^T[0-9]{4}$' AND punch_date=?", [day]);
      const [overtime] = await db.query("DELETE FROM attendance_overtime_punches WHERE approval_id LIKE 'MOT%'");
      console.log(JSON.stringify({ mode, day, deletedSyntheticPunches: punches.affectedRows, deletedSyntheticOvertime: overtime.affectedRows }));
    } else {
      const [punch] = await db.query("SELECT COUNT(*) total,COUNT(check_in) checked FROM attendance_punches WHERE employee_id REGEXP '^T[0-9]{4}$' AND punch_date=?", [day]);
      const [overtime] = await db.query("SELECT COUNT(*) total,COUNT(check_out) completed FROM attendance_overtime_punches WHERE approval_id LIKE 'MOT%'");
      const [approvals] = await db.query("SELECT COUNT(*) total,COUNT(DISTINCT id) distinctIds FROM approvals WHERE title='morning synthetic purchase'");
      console.log(JSON.stringify({ mode, day, punch: punch[0], overtime: overtime[0], approvals: approvals[0] }));
    }
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
