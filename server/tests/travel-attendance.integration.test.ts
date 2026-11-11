import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import type { AttendanceMetric } from '../src/domains/payroll/salaryModelService';

test('出差审批通过后按起止日期标记出差状态并计入出勤', async (t) => {
  const database = `yunqi_travel_test_${randomBytes(8).toString('hex')}`;
  assert.match(database, /^yunqi_travel_test_[0-9a-f]{16}$/);
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '',
  });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const poolModule = await import('../src/shared/db/pool');
    closePool = poolModule.closePool;
    await poolModule.ensureSchema();
    const { seedDatabase } = await import('../src/shared/db/seed');
    await seedDatabase();
    const { ensureDefaultAdmin } = await import('../src/admin/admin-accounts/adminAuthService');
    await ensureDefaultAdmin();
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const { config } = await import('../src/config');
    const { createApp } = await import('../src/app');
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const employee = issueTokens('U001').accessToken;

    async function request(path: string, token: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, payload: await response.json() as { data?: any; message?: string } };
    }

    // 固定时间到无历史演示数据的工作日；出差区间 8-05（周三）至 8-07（周五）。
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-06T10:00:00') });
    const position = { latitude: 23.1, longitude: 113.3, accuracy: 10 };

    // 建考勤组绑定种子默认公司日历，保证出勤天数可解析。
    const rules = await request('/admin/models-formulas/calendar-rules', admin);
    const groupId = await request('/admin/attendance/groups', admin, 'POST', {
      name: '全员组', calendarRuleId: rules.payload.data[0].id, employeeIds: ['U001'],
      startTime: '09:00', inEndTime: '09:50', endTime: '17:40', outEndTime: '19:50',
      latitude: 23.1, longitude: 113.3, radius: 100,
    });
    assert.equal(groupId.status, 200);

    // 已通过的出差审批：表单按小程序字段名保存。
    const form = JSON.stringify([
      { label: '出差城市', value: '北京' },
      { label: '开始日期', value: '2026-08-05' },
      { label: '结束日期', value: '2026-08-07' },
      { label: '出差事由', value: '客户现场支持' },
    ]);
    await connection.query(
      `INSERT INTO \`${database}\`.approvals (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept, applicant_position, node, summary, form_json, created_at)
       VALUES ('TV1', 'travel', '出差', '出差申请 · 北京', 'approved', 0, 'U001', '陈亦然', '', '员工', '已通过', '2026-08-05 至 2026-08-07，目的地：北京', ?, NOW())`,
      [form]
    );

    const today = await request('/attendance/today', employee);
    assert.equal(today.payload.data.status, 'travel');
    assert.equal(today.payload.data.statusText, '出差');
    assert.equal(today.payload.data.nextType, 'wait');
    assert.equal(today.payload.data.nextText, '出差期间无需打卡');

    const punchDenied = await request('/attendance/punch', employee, 'POST', { type: 'in', ...position });
    assert.equal(punchDenied.payload.data.ok, false);
    assert.equal(punchDenied.payload.data.message, '出差期间无需打卡');

    const records = await request('/attendance/records?days=7', employee);
    const statuses = Object.fromEntries((records.payload.data as Array<{ date: string; status: string }>).map((r) => [r.date, r.status]));
    assert.equal(statuses['2026-08-05'], 'travel');
    assert.equal(statuses['2026-08-06'], 'travel');
    assert.equal(statuses['2026-08-04'], 'absent');

    const monthly = await request('/admin/attendance?month=2026-08&employeeId=U001', admin);
    const summaryRow = monthly.payload.data.employeeSummary.find((row: { employeeId: string }) => row.employeeId === 'U001');
    // 管理端月度查询截止到今天（8-06），出差区间统计 8-05、8-06 两天；8-07 由工资整月口径覆盖。
    assert.equal(summaryRow.travel, 2);
    assert.equal(summaryRow.presentDays, 2);
    const travelDay = monthly.payload.data.list.find((row: { date: string }) => row.date === '2026-08-05');
    assert.equal(travelDay.status, 'travel');
    assert.equal(travelDay.statusText, '出差');

    // 出差日计入工资出勤：无需打卡也按正常出勤计算。
    await connection.query(
      `INSERT INTO \`${database}\`.attendance_punches
        (employee_id, punch_date, check_in, check_out, status_override, note, source, updated_by_admin_id, created_at, updated_at)
       VALUES ('U001','2026-08-03','09:00','18:00',NULL,NULL,'seed',NULL,NOW(),NOW()),
              ('U001','2026-08-10','09:00','18:00',NULL,NULL,'seed',NULL,NOW(),NOW())
       ON DUPLICATE KEY UPDATE check_in = VALUES(check_in), check_out = VALUES(check_out)`
    );
    const { readPayrollAttendance } = await import('../src/domains/attendance/payrollAttendanceSource');
    const payroll = await poolModule.transaction((conn) => readPayrollAttendance(
      conn,
      [{ id: 'U001', name: '陈亦然' }],
      '2026-08',
      new Set<AttendanceMetric>(['presentDays'])
    ));
    // 出差 3 天 + 完整打卡 2 天 = 5 个出勤天；出差日不打卡不扣出勤。
    assert.equal(payroll.get('U001')?.presentDays, 5);

    // 出差日无法补打卡，管理员更正显示出差状态。
    const monthlyDay = await request('/admin/attendance?date=2026-08-05&employeeId=U001', admin);
    assert.equal(monthlyDay.payload.data.list[0].status, 'travel');
  } finally {
    t.mock.timers.reset();
    await closeServer?.();
    await closePool?.();
    if (created) await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.end();
  }
});
