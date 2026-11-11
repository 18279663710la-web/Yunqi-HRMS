import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import type { AttendanceMetric } from '../src/domains/payroll/salaryModelService';

test('请假审批通过后按起止日期标记请假状态，休息日与出差优先级按规则覆盖', async (t) => {
  const database = `yunqi_leave_test_${randomBytes(8).toString('hex')}`;
  assert.match(database, /^yunqi_leave_test_[0-9a-f]{16}$/);
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

    // 固定时间：请假 8-06（周四，半天 14:00 起）至 8-07（周五）；8-07 同时是日历例外休息日（休息优先）。
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-07T10:00:00') });
    const position = { latitude: 23.1, longitude: 113.3, accuracy: 10 };

    // 建考勤组绑定日历；日历设 8-07 为例外休息日（验证休息优先于请假）。
    const rules = await request('/admin/models-formulas/calendar-rules', admin);
    assert.equal((await request('/admin/models-formulas/calendar-rules/1', admin, 'PUT', {
      name: '默认公司日历', mode: 'none', weeklyRestDays: [], cycleWeeks: null, cycleRestDays: [],
      anchorDate: null, restDates: ['2026-08-07'], workDates: [],
    })).status, 200);
    assert.equal((await request('/admin/attendance/groups', admin, 'POST', {
      name: '全员组', calendarRuleId: rules.payload.data[0].id, employeeIds: ['U001'],
      startTime: '09:00', inEndTime: '09:50', endTime: '17:40', outEndTime: '19:50',
      latitude: 23.1, longitude: 113.3, radius: 100,
    })).status, 200);

    // 已通过的请假审批：开始时间 14:00（覆盖即整天标记），结束 8-07。
    const form = JSON.stringify([
      { label: '请假类型', value: '事假' },
      { label: '开始日期', value: '2026-08-06' },
      { label: '开始时间', value: '14:00' },
      { label: '结束日期', value: '2026-08-07' },
      { label: '结束时间', value: '18:00' },
      { label: '请假时长（天）', value: '2' },
    ]);
    await connection.query(
      `INSERT INTO \`${database}\`.approvals (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept, applicant_position, node, summary, form_json, created_at)
       VALUES ('LV1', 'leave', '请假', '请假申请 · 事假 2 天', 'approved', 0, 'U001', '陈亦然', '', '员工', '已通过', '2026-08-06 至 2026-08-07，共 2 天', ?, NOW())`,
      [form]
    );

    const today = await request('/attendance/today', employee);
    // 8-07 同时是请假日与日历休息日：休息优先显示。
    assert.equal(today.payload.data.status, 'rest');
    assert.equal(today.payload.data.statusText, '休息');
    assert.equal(today.payload.data.nextText, '休息日无需打卡');

    const punchDenied = await request('/attendance/punch', employee, 'POST', { type: 'in', ...position });
    assert.equal(punchDenied.payload.data.ok, false);
    assert.equal(punchDenied.payload.data.message, '休息日无需打卡');

    // 8-06 请假（覆盖即整天，开始时间 14:00 不影响）；8-07 休息优先于请假。
    const records = await request('/attendance/records?days=7', employee);
    const statuses = Object.fromEntries((records.payload.data as Array<{ date: string; status: string }>).map((r) => [r.date, r.status]));
    assert.equal(statuses['2026-08-06'], 'leave');
    assert.equal(statuses['2026-08-07'], 'rest');

    const monthly = await request('/admin/attendance?month=2026-08&employeeId=U001', admin);
    const summaryRow = monthly.payload.data.employeeSummary.find((row: { employeeId: string }) => row.employeeId === 'U001');
    // 月度查询截止到今天（8-07）：请假 1 天、休息 1 天。
    assert.equal(summaryRow.leave, 1);
    assert.equal(summaryRow.rest, 1);

    // 工资口径：请假日不计实际出勤（按缺勤参与绩效），与手工登记一致。
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
    // 仅完整打卡 2 天计出勤；请假 8-06 与日历休息 8-07 均不计。
    assert.equal(payroll.get('U001')?.presentDays, 2);

    // 与出差重叠：出差优先于请假。出差 8-06 至 8-08，8-06/8-07 均显示出差。
    const travelForm = JSON.stringify([
      { label: '出差城市', value: '上海' },
      { label: '开始日期', value: '2026-08-06' },
      { label: '结束日期', value: '2026-08-08' },
      { label: '出差事由', value: '客户拜访' },
    ]);
    await connection.query(
      `INSERT INTO \`${database}\`.approvals (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept, applicant_position, node, summary, form_json, created_at)
       VALUES ('TV1', 'travel', '出差', '出差申请 · 上海', 'approved', 0, 'U001', '陈亦然', '', '员工', '已通过', '2026-08-06 至 2026-08-08，目的地：上海', ?, NOW())`,
      [travelForm]
    );
    const afterTravel = await request('/attendance/records?days=7', employee);
    const afterStatuses = Object.fromEntries((afterTravel.payload.data as Array<{ date: string; status: string }>).map((r) => [r.date, r.status]));
    assert.equal(afterStatuses['2026-08-06'], 'travel');
    assert.equal(afterStatuses['2026-08-07'], 'travel');
  } finally {
    t.mock.timers.reset();
    await closeServer?.();
    await closePool?.();
    if (created) await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.end();
  }
});
