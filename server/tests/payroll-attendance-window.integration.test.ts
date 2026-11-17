import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import type { AttendanceMetric } from '../src/domains/payroll/salaryModelService';

function monthDays(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

test('工资出勤按在职窗口和考勤状态取数', async () => {
  const database = `yunqi_payroll_window_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool');
    closePool = pool.closePool;
    await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData();
    const q = (sql: string, params?: unknown[]) => conn.query(sql, params);
    const employee = [{ id: 'U001', name: '陈亦然' }];
    const read = async (month: string, attendanceRule = false) => {
      const { readPayrollAttendance } = await import('../src/domains/attendance/payrollAttendanceSource');
      return pool.transaction(async (tx) => {
        const values = await readPayrollAttendance(tx, employee, month, new Set<AttendanceMetric>(['presentDays']), { attendanceRule });
        return values.get('U001');
      });
    };
    const approval = (id: string, type: string, form: unknown) => q(
      `INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES (?,?,?,?, 'approved','U001','陈亦然','','研发员',?,NOW())`,
      [id, type, type === 'travel' ? '出差' : '请假', type === 'travel' ? '出差' : '请假', JSON.stringify(form)],
    );
    await q(`INSERT INTO \`${database}\`.attendance_settings (id,start_time,end_time,rest_dates,latitude,longitude,radius) VALUES (1,'09:00','18:00',?,0,0,100)`, [JSON.stringify(['2020-06-16', '2020-06-18', ...monthDays('2020-08')])]);
    await q(`UPDATE \`${database}\`.employees SET join_date='2019-01-01' WHERE id='U001'`);
    await q(`INSERT INTO \`${database}\`.hr_settings (setting_key,value_json,updated_at) VALUES ('payroll_attendance_rule_config',?,NOW())`, [JSON.stringify({ mode: 'days_absence', calculation: 'unit', unitAdjustment: -10 })]);

    await approval('TV-WIN', 'travel', [{ label: '开始日期', value: '2020-07-01' }, { label: '结束日期', value: '2020-07-31' }]);
    const travelOnly = await read('2020-07', true);
    assert.equal(travelOnly?.presentDays, 31);
    assert.equal(travelOnly?.attendanceCalculation?.workdays, 31);
    assert.equal(travelOnly?.attendanceCalculation?.presentDays, 31);
    assert.ok(travelOnly?.attendanceAdjustment === 0);

    const allRest = await read('2020-08', true);
    assert.equal(allRest?.presentDays, 0);
    assert.equal(allRest?.attendanceAdjustment, 0);
    assert.equal(allRest?.attendanceCalculation?.workdays, 0);
    assert.equal(allRest?.attendanceCalculation?.presentDays, 0);

    await assert.rejects(read('2020-09'), /没有考勤记录/);

    await q(`UPDATE \`${database}\`.employees SET join_date='2020-06-15' WHERE id='U001'`);
    await q(`INSERT INTO \`${database}\`.hr_employee_departures (employee_id,last_date,status,created_by,created_at) VALUES ('U001','2020-06-24','departed',1,NOW())`);
    await q(
      `INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES
       ('U001','2020-06-01','09:00','18:00','admin',NOW(),NOW()),
       ('U001','2020-06-15','09:00','18:00','admin',NOW(),NOW()),
       ('U001','2020-06-17','09:00','18:00','admin',NOW(),NOW()),
       ('U001','2020-06-19','09:00','18:00','admin',NOW(),NOW()),
       ('U001','2020-06-22','09:00',NULL,'admin',NOW(),NOW()),
       ('U001','2020-06-23',NULL,'18:00','admin',NOW(),NOW())`,
    );
    const employed = await read('2020-06', true);
    assert.equal(employed?.presentDays, 3);
    assert.equal(employed?.attendanceCalculation?.workdays, 8);
    assert.equal(employed?.attendanceCalculation?.presentDays, 3);
    assert.equal(employed?.attendanceAdjustment, -50);
    await q(`DELETE FROM \`${database}\`.hr_employee_departures WHERE employee_id='U001'`);
    await q(`UPDATE \`${database}\`.employees SET join_date='2019-01-01' WHERE id='U001'`);

    await q(
      `INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,status_override,source,created_at,updated_at) VALUES
       ('U001','2020-10-01','09:00','18:00',NULL,'admin',NOW(),NOW()),
       ('U001','2020-10-02','09:00','18:00','rest','admin',NOW(),NOW()),
       ('U001','2020-10-04','09:00','18:00','rest','admin',NOW(),NOW())`,
    );
    await approval('TV-REST', 'travel', [{ label: '开始日期', value: '2020-10-03' }, { label: '结束日期', value: '2020-10-05' }]);
    const manualRest = await read('2020-10', true);
    assert.equal(manualRest?.presentDays, 3);
    assert.equal(manualRest?.attendanceCalculation?.workdays, 29);
    assert.equal(manualRest?.attendanceCalculation?.presentDays, 3);

    await q(`INSERT INTO \`${database}\`.hr_employee_departures (employee_id,last_date,reinstatement_date,status,created_by,created_at) VALUES ('U001','2020-11-10','2020-11-20','cancelled',1,NOW())`);
    await q(
      `INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES
       ('U001','2020-11-10','09:00','18:00','admin',NOW(),NOW()),
       ('U001','2020-11-15','09:00','18:00','admin',NOW(),NOW()),
       ('U001','2020-11-20','09:00','18:00','admin',NOW(),NOW())`,
    );
    const gap = await read('2020-11', true);
    assert.equal(gap?.presentDays, 2);
    assert.equal(gap?.attendanceCalculation?.workdays, 21);
    assert.equal(gap?.attendanceCalculation?.presentDays, 2);
    await q(`DELETE FROM \`${database}\`.hr_employee_departures WHERE employee_id='U001'`);

    await q(`INSERT INTO \`${database}\`.hr_employee_departures (employee_id,last_date,status,created_by,created_at) VALUES ('U001','2020-12-10','cancelled',1,NOW())`);
    await q(`INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES ('U001','2020-12-01','09:00','18:00','admin',NOW(),NOW())`);
    const revoked = await read('2020-12', true);
    assert.equal(revoked?.presentDays, 1);
    assert.equal(revoked?.attendanceCalculation?.workdays, 31);
    await q(`DELETE FROM \`${database}\`.hr_employee_departures WHERE employee_id='U001'`);

    await q(`INSERT INTO \`${database}\`.hr_employee_departures (employee_id,last_date,reinstatement_date,status,created_by,created_at) VALUES ('U001','2021-01-10','2021-02-01','departed',1,NOW())`);
    await q(
      `INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES
       ('U001','2021-01-10','09:00','18:00','admin',NOW(),NOW()),
       ('U001','2021-01-15','09:00','18:00','admin',NOW(),NOW())`,
    );
    const pending = await read('2021-01', true);
    assert.equal(pending?.presentDays, 1);
    assert.equal(pending?.attendanceCalculation?.workdays, 10);
    assert.equal(pending?.attendanceCalculation?.presentDays, 1);
    await q(`DELETE FROM \`${database}\`.hr_employee_departures WHERE employee_id='U001'`);

    await approval('LV-ALL', 'leave', [{ label: '开始日期', value: '2021-03-01' }, { label: '结束日期', value: '2021-03-31' }]);
    const leaveOnly = await read('2021-03', true);
    assert.equal(leaveOnly?.presentDays, 0);
    assert.equal(leaveOnly?.attendanceCalculation?.workdays, 31);
    assert.equal(leaveOnly?.attendanceAdjustment, -310);

    await q(`UPDATE \`${database}\`.employees SET join_date='2022-03-01' WHERE id='U001'`);
    const beforeJoin = await read('2020-01', true);
    assert.equal(beforeJoin?.presentDays, 0);
    assert.equal(beforeJoin?.attendanceAdjustment, 0);
    assert.equal(beforeJoin?.attendanceCalculation?.workdays, 0);
  } finally {
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
