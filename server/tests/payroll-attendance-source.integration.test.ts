import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('工资明细自动读取员工月度考勤，阻止不完整打卡并保留快照', async () => {
  const database = `yunqi_payroll_attendance_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true; process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const admin = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: '1' });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() as { data?: any; message?: string } };
    };
    const original = (await call('/admin/hr/salary-model')).body.data;
    const saved = await call('/admin/hr/salary-model', 'PUT', { version: original.version, fixedFields: [
      { name: '基本工资', type: 'number', category: 'income', required: true },
      { name: '出勤天数', type: 'number', category: 'info', required: true, interfaceSource: 'attendance', attendanceMetric: 'presentDays' },
    ], extendedFields: [{ name: '加班时长', type: 'number', category: 'info', required: true, interfaceSource: 'attendance', attendanceMetric: 'overtimeHours' }, { name: '加班费', type: 'number', category: 'income', required: true, interfaceSource: 'attendance', attendanceMetric: 'overtimePay' }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.extendedFields[0].attendanceMetric, 'overtimeHours');
    for (const employee of ['U001', 'U013']) {
      await conn.query(`INSERT INTO \`${database}\`.hr_self_onboarding (employee_id,expected_date,template_json,answers_json,created_at,submitted_at,archived_at,archived_by) VALUES (?,'2020-01-01','[]','{}',NOW(),NOW(),NOW(),1)`, [employee]);
      await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id,section,data_json,updated_at) VALUES (?, 'contract', ?, NOW()), (?, 'salary', ?, NOW())`, [employee, JSON.stringify({ number: 'C', startDate: '2020-01-01', endDate: '2030-01-01' }), employee, JSON.stringify({ effectiveDate: '2020-01-01', values: { 基本工资: 1000, 出勤天数: 99 } })]);
    }
    await conn.query(`INSERT INTO \`${database}\`.attendance_settings (id,start_time,end_time,rest_dates,address,floor,latitude,longitude,radius) VALUES (1,'09:00','18:00',?,'','',0,0,100) ON DUPLICATE KEY UPDATE rest_dates=VALUES(rest_dates)`, [JSON.stringify(['2020-02-02'])]);
    await conn.query(`INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES ('U001','2020-02-01','09:00','18:00','admin',NOW(),NOW()), ('U001','2020-02-02','09:00','18:00','admin',NOW(),NOW()), ('U013','2020-02-03','09:00',NULL,'admin',NOW(),NOW())`);
    await conn.query(`INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES ('OT1','overtime','加班','加班','approved','U001','员工','','员工','[]',NOW()), ('OT2','overtime','加班','加班','approved','U013','员工','','员工','[]',NOW())`);
    await conn.query(`UPDATE \`${database}\`.approvals SET form_json=? WHERE id IN ('OT1','OT2')`, [JSON.stringify([{ label: '补偿方式', value: '加班费' }])]);
    await conn.query(`INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES ('OT3','overtime','加班','加班','approved','U001','员工','','员工',?,NOW())`, [JSON.stringify([{ label: '补偿方式', value: '调休' }])]);
    const rangeConfig = { calculation: 'range', rules: [{ minHours: 0, maxHours: 1, hourlyRate: 10 }, { minHours: 1, maxHours: null, hourlyRate: 20 }] };
    assert.equal((await call('/admin/hr/overtime-payroll-rule-config', 'PUT', rangeConfig)).status, 200);
    await conn.query(`INSERT INTO \`${database}\`.attendance_overtime_punches (approval_id,employee_id,check_in,check_out) VALUES ('OT1','U001','2020-02-29 23:30:00','2020-03-01 01:00:00'), ('OT2','U013','2020-02-03 19:00:00',NULL)`);
    await conn.query(`INSERT INTO \`${database}\`.attendance_overtime_punches (approval_id,employee_id,check_in,check_out) VALUES ('OT3','U001','2020-02-20 19:00:00','2020-02-20 21:00:00')`);
    const batch = (await call('/admin/hr/payroll-batches', 'POST', { month: '2020-02' })).body.data.id;
    const [numberRows] = await conn.query<mysql.RowDataPacket[]>(`SELECT employee_no FROM \`${database}\`.employees WHERE id='U013'`);
    await conn.query(`UPDATE \`${database}\`.employees SET employee_no=(SELECT employee_no FROM (SELECT employee_no FROM \`${database}\`.employees WHERE id='U001') source_employee) WHERE id='U013'`);
    const ambiguous = await call(`/admin/hr/payroll-batches/${batch}/auto-preview`);
    assert.equal(ambiguous.status, 400);
    assert.match(ambiguous.body.message || '', /员工号/);
    await conn.query(`UPDATE \`${database}\`.employees SET employee_no='' WHERE id='U013'`);
    const missingNumber = await call(`/admin/hr/payroll-batches/${batch}/auto-preview`);
    assert.equal(missingNumber.status, 400);
    assert.match(missingNumber.body.message || '', /员工号/);
    await conn.query(`UPDATE \`${database}\`.employees SET employee_no=? WHERE id='U013'`, [numberRows[0].employee_no]);
    const broken = await call(`/admin/hr/payroll-batches/${batch}/auto-preview`);
    assert.equal(broken.status, 400); assert.match(broken.body.message || '', /打卡/);
    assert.equal((await call(`/admin/hr/payroll-batches/${batch}/auto-items`, 'POST', {})).status, 400);
    assert.equal((await call(`/admin/hr/payroll-batches/${batch}/items`)).body.data.length, 0);
    await conn.query(`UPDATE \`${database}\`.attendance_punches SET check_out='18:00' WHERE employee_id='U013' AND punch_date='2020-02-03'`);
    const unfinished = await call(`/admin/hr/payroll-batches/${batch}/auto-preview`);
    assert.equal(unfinished.status, 400); assert.match(unfinished.body.message || '', /加班打卡/);
    await conn.query(`UPDATE \`${database}\`.attendance_overtime_punches SET check_out='2020-02-03 20:00:00' WHERE approval_id='OT2'`);
    await conn.query(`UPDATE \`${database}\`.attendance_overtime_punches SET check_out='2020-02-29 22:00:00' WHERE approval_id='OT1'`);
    const invalid = await call(`/admin/hr/payroll-batches/${batch}/auto-preview`);
    assert.equal(invalid.status, 400); assert.match(invalid.body.message || '', /加班时长无效/);
    await conn.query(`UPDATE \`${database}\`.attendance_overtime_punches SET check_out='2020-03-01 01:00:00' WHERE approval_id='OT1'`);
    const preview = await call(`/admin/hr/payroll-batches/${batch}/auto-preview`); assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const one = preview.body.data.candidates.find((candidate: any) => candidate.employeeId === 'U001');
    assert.equal(one.modelSnapshot.fixed.find((field: any) => field.name === '出勤天数').value, 1);
    assert.equal(one.modelSnapshot.fixed.find((field: any) => field.name === '出勤天数').attendanceEmployeeNo, one.employeeNo);
    assert.equal(one.modelSnapshot.fixed.find((field: any) => field.name === '出勤天数').attendancePeriod, '2020-02');
    assert.equal(one.modelSnapshot.extended[0].value, 3.5);
    assert.equal(one.modelSnapshot.extended[0].attendanceMetric, 'overtimeHours');
    assert.equal(one.modelSnapshot.extended[1].value, 30);
    assert.equal(one.modelSnapshot.extended[1].overtimeCalculation.seconds, 5400);
    assert.deepEqual(one.modelSnapshot.extended[1].overtimeCalculation.config, rangeConfig);
    assert.equal(one.gross, 1030);
    assert.equal((await call('/admin/hr/overtime-payroll-rule-config', 'PUT', { calculation: 'unit', hourlyRate: 50 })).status, 200);
    const unitPreview = await call(`/admin/hr/payroll-batches/${batch}/auto-preview`);
    assert.equal(unitPreview.body.data.candidates.find((candidate: any) => candidate.employeeId === 'U001').modelSnapshot.extended[1].value, 75);
    assert.equal((await call('/admin/hr/overtime-payroll-rule-config', 'PUT', rangeConfig)).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${batch}/items`, 'POST', { employeeId: 'U001' })).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${batch}/auto-items`, 'POST', {})).body.data.addedCount, 1);
    const items = (await call(`/admin/hr/payroll-batches/${batch}/items`)).body.data;
    const item = items.find((row: any) => row.employeeId === 'U001');
    assert.equal(item.modelSnapshot.extended[0].value, 3.5);
    assert.equal((await call(`/admin/hr/payroll-batches/${batch}/items/${item.id}/extended`, 'PUT', { revision: 0, values: [{ name: '加班时长', value: 3.5 }, { name: '加班费', value: 99 }] })).status, 400);
    assert.equal((await call(`/admin/hr/payroll-batches/${batch}/items/${item.id}/extended`, 'PUT', { revision: 0, values: [{ name: '加班时长', value: 3.5 }, { name: '加班费', value: 30 }] })).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${batch}/review`, 'POST', {})).status, 200);
    await conn.query(`UPDATE \`${database}\`.attendance_overtime_punches SET check_out='2020-03-01 02:00:00' WHERE approval_id='OT1'`);
    assert.equal((await call('/admin/hr/overtime-payroll-rule-config', 'PUT', { calculation: 'unit', hourlyRate: 50 })).status, 200);
    const reviewed = (await call(`/admin/hr/payroll-batches/${batch}/items`)).body.data.find((row: any) => row.employeeId === 'U001');
    assert.equal(reviewed.modelSnapshot.extended[0].value, 3.5);
    assert.equal(reviewed.modelSnapshot.extended[1].value, 30);
    assert.deepEqual(reviewed.modelSnapshot.extended[1].overtimeCalculation.config, rangeConfig);
    const missingBatch = (await call('/admin/hr/payroll-batches', 'POST', { month: '2020-04' })).body.data.id;
    const missing = await call(`/admin/hr/payroll-batches/${missingBatch}/items`, 'POST', { employeeId: 'U001' });
    assert.equal(missing.status, 400); assert.match(missing.body.message || '', /没有考勤记录/);
    await conn.query(`INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES ('U001','2020-04-01','09:00','18:00','admin',NOW(),NOW())`);
    assert.equal((await call(`/admin/hr/payroll-batches/${missingBatch}/items`, 'POST', { employeeId: 'U001' })).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${missingBatch}/items`)).body.data[0].modelSnapshot.extended[0].value, 0);
    const currentModel = (await call('/admin/hr/salary-model')).body.data;
    const fixedPay = await call('/admin/hr/salary-model', 'PUT', { version: currentModel.version, fixedFields: [{ name: '基本工资', type: 'number', category: 'income', required: true }, { name: '加班费', type: 'number', category: 'income', required: true, interfaceSource: 'attendance', attendanceMetric: 'overtimePay' }], extendedFields: [] });
    assert.equal(fixedPay.status, 200, JSON.stringify(fixedPay.body));
    await conn.query(`INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES ('OT4','overtime','加班','加班','approved','U001','员工','','员工',?,NOW())`, [JSON.stringify([{ label: '补偿方式', value: '加班费' }])]);
    await conn.query(`INSERT INTO \`${database}\`.attendance_overtime_punches (approval_id,employee_id,check_in,check_out) VALUES ('OT4','U001','2020-05-01 19:00:00','2020-05-01 21:00:00')`);
    const fixedBatch = (await call('/admin/hr/payroll-batches', 'POST', { month: '2020-05' })).body.data.id;
    assert.equal((await call(`/admin/hr/payroll-batches/${fixedBatch}/items`, 'POST', { employeeId: 'U001' })).status, 200);
    const fixedItem = (await call(`/admin/hr/payroll-batches/${fixedBatch}/items`)).body.data[0];
    assert.equal(fixedItem.modelSnapshot.fixed.find((field: any) => field.name === '加班费').value, 100);
    assert.equal(fixedItem.gross, 1100);

    const model2 = (await call('/admin/hr/salary-model')).body.data;
    const calculatedModel = await call('/admin/hr/salary-model', 'PUT', { version: model2.version, fixedFields: [{ name: '基本工资', type: 'number', category: 'income', required: true }], extendedFields: [
      { name: '出勤绩效', type: 'number', category: 'income', required: true, interfaceSource: 'attendance', attendanceMetric: 'presentDays', calculationRule: 'attendance' },
      { name: '加班费', type: 'number', category: 'income', required: true, interfaceSource: 'attendance', attendanceMetric: 'overtimeHours', calculationRule: 'overtime' },
      { name: '全部加班时长', type: 'number', category: 'info', required: true, interfaceSource: 'attendance', attendanceMetric: 'overtimeHours', calculationRule: 'direct' },
    ] });
    assert.equal(calculatedModel.status, 200, JSON.stringify(calculatedModel.body));
    assert.equal((await call('/admin/hr/attendance-payroll-rule-config-v2', 'PUT', { mode: 'days_absence', calculation: 'unit', unitAdjustment: -10 })).status, 200);
    await conn.query(`UPDATE \`${database}\`.employees SET join_date='2020-06-15' WHERE id='U001'`);
    await conn.query(`INSERT INTO \`${database}\`.hr_employee_departures (offboarding_id,employee_id,last_date,status,created_by,created_at) VALUES (900,'U001','2020-06-24','departed',1,NOW())`);
    await conn.query(`UPDATE \`${database}\`.attendance_settings SET rest_dates=? WHERE id=1`, [JSON.stringify(['2020-06-16', '2020-06-18'])]);
    await conn.query(`INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES ('U001','2020-06-15','09:00','18:00','admin',NOW(),NOW()),('U001','2020-06-17','09:00','18:00','admin',NOW(),NOW()),('U001','2020-06-19','09:00','18:00','admin',NOW(),NOW())`);
    await conn.query(`INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES ('OT5','overtime','加班','加班','approved','U001','员工','','员工',?,NOW()),('OT6','overtime','加班','加班','approved','U001','员工','','员工',?,NOW())`, [JSON.stringify([{ label: '补偿方式', value: '加班费' }]), JSON.stringify([{ label: '补偿方式', value: '调休' }])]);
    await conn.query(`INSERT INTO \`${database}\`.attendance_overtime_punches (approval_id,employee_id,check_in,check_out) VALUES ('OT5','U001','2020-06-20 19:00:00','2020-06-20 21:00:00'),('OT6','U001','2020-06-21 19:00:00','2020-06-21 20:00:00')`);
    await conn.query(`DELETE FROM \`${database}\`.hr_employee_records WHERE employee_id='U013' AND section='salary'`);
    const rulesBatch = (await call('/admin/hr/payroll-batches', 'POST', { month: '2020-06' })).body.data.id;
    const rulesPreview = await call(`/admin/hr/payroll-batches/${rulesBatch}/auto-preview`);
    assert.equal(rulesPreview.status, 200, JSON.stringify(rulesPreview.body));
    const candidate = rulesPreview.body.data.candidates[0];
    assert.equal(candidate.modelSnapshot.extended[0].value, -50);
    assert.equal(candidate.modelSnapshot.extended[0].attendanceCalculation.workdays, 8);
    assert.equal(candidate.modelSnapshot.extended[0].attendanceCalculation.presentDays, 3);
    assert.equal(candidate.modelSnapshot.extended[1].value, 100);
    assert.equal(candidate.modelSnapshot.extended[2].value, 3);
    assert.equal(candidate.gross, 1050);
    assert.equal((await call(`/admin/hr/payroll-batches/${rulesBatch}/items`, 'POST', { employeeId: 'U001' })).status, 200);
    const rulesItem = (await call(`/admin/hr/payroll-batches/${rulesBatch}/items`)).body.data[0];
    assert.equal(rulesItem.gross, 1050);
    assert.equal((await call(`/admin/hr/payroll-batches/${rulesBatch}/items/${rulesItem.id}/extended`, 'PUT', { revision: 0, values: [{ name: '出勤绩效', value: -50 }, { name: '加班费', value: 100 }, { name: '全部加班时长', value: 3 }] })).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${rulesBatch}/items/${rulesItem.id}/extended`, 'PUT', { revision: 1, values: [{ name: '出勤绩效', value: -20 }, { name: '加班费', value: 100 }, { name: '全部加班时长', value: 3 }] })).status, 400);
    assert.equal((await call('/admin/hr/attendance-payroll-rule-config-v2', 'PUT', { mode: 'days_absence', calculation: 'unit', unitAdjustment: -20 })).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${rulesBatch}/items`)).body.data[0].modelSnapshot.extended[0].value, -50);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
