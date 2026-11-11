import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import type { AttendanceMetric } from '../src/domains/payroll/salaryModelService';

test('考勤组独立保存规则并覆盖所选员工，未分配员工使用第一个考勤组', async (t) => {
  const database = `yunqi_att_group_test_${randomBytes(8).toString('hex')}`;
  assert.match(database, /^yunqi_att_group_test_[0-9a-f]{16}$/);
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
    const employee = (id: string) => issueTokens(id).accessToken;

    async function request(path: string, token: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, payload: await response.json() as { data?: any; message?: string } };
    }

    // 使用不在种子考勤范围内的工作日，避免历史演示数据干扰。
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-04T17:30:00') });
    const position = { latitude: 23.1, longitude: 113.3, accuracy: 10 };
    const defaultSettings = {
      startTime: '08:00', inEndTime: '10:00', endTime: '16:00', outEndTime: '16:30',
      restDates: ['2026-08-03'], address: '默认地点', floor: '1楼',
      latitude: 23.1, longitude: 113.3, radius: 100,
    };
    assert.equal((await request('/admin/attendance/settings', admin, 'PUT', defaultSettings)).status, 200);

    const earlySettings = {
      startTime: '17:00', inEndTime: '18:00', endTime: '19:00', outEndTime: '20:00',
      restDates: ['2026-08-02'], address: '早班地点', floor: '',
      latitude: 23.1, longitude: 113.3, radius: 100,
    };
    const early = await request('/admin/attendance/groups', admin, 'POST', {
      ...earlySettings, name: '早班组', employeeIds: ['U001', 'U005'],
    });
    assert.equal(early.status, 200);

    const late = await request('/admin/attendance/groups', admin, 'POST', {
      ...defaultSettings, restDates: [], address: '晚班地点', name: '晚班组', employeeIds: ['U010'],
    });
    assert.equal(late.status, 200);
    const earlyId = early.payload.data.id as number;
    const lateId = late.payload.data.id as number;

    const groups = await request('/admin/attendance/groups', admin);
    assert.equal(groups.payload.data.groups.length, 2);
    assert.equal(groups.payload.data.unassignedCount, 3);
    assert.deepEqual(groups.payload.data.groups.find((group: { id: number }) => group.id === earlyId).employeeIds, ['U001', 'U005']);

    const earlyEmployee = await request('/attendance/settings', employee('U001'));
    assert.equal(earlyEmployee.payload.data.startTime, '17:00');
    assert.equal(earlyEmployee.payload.data.address, '早班地点');
    const unassignedEmployee = await request('/attendance/settings', employee('U011'));
    assert.equal(unassignedEmployee.payload.data.startTime, '17:00');
    assert.equal(unassignedEmployee.payload.data.address, '早班地点');

    assert.equal((await request('/attendance/punch', employee('U011'), 'POST', { type: 'in', ...position })).payload.data.ok, true);
    const earlyPunch = await request('/attendance/punch', employee('U001'), 'POST', { type: 'in', ...position });
    assert.equal(earlyPunch.payload.data.ok, true);

    const earlyToday = await request('/attendance/today', employee('U001'));
    assert.equal(earlyToday.payload.data.workTime, '17:00 - 19:00');
    assert.equal(earlyToday.payload.data.address, '早班地点');
    const unassignedToday = await request('/attendance/today', employee('U011'));
    assert.equal(unassignedToday.payload.data.workTime, '17:00 - 19:00');
    assert.equal(unassignedToday.payload.data.address, '早班地点');

    const earlyRest = await request('/admin/attendance?date=2026-08-02&employeeId=U001', admin);
    assert.equal(earlyRest.payload.data.list[0].status, 'rest');
    const unassignedRest = await request('/admin/attendance?date=2026-08-02&employeeId=U011', admin);
    assert.equal(unassignedRest.payload.data.list[0].status, 'rest');
    const unassignedWorkday = await request('/admin/attendance?date=2026-08-03&employeeId=U011', admin);
    assert.equal(unassignedWorkday.payload.data.list[0].status, 'absent');

    await connection.query(
      `INSERT INTO \`${database}\`.attendance_punches
        (employee_id, punch_date, check_in, check_out, status_override, note, source, updated_by_admin_id, created_at, updated_at)
       VALUES ('U001','2026-08-02','09:00','18:00',NULL,NULL,'seed',NULL,NOW(),NOW()),
              ('U001','2026-08-04','09:00','18:00',NULL,NULL,'seed',NULL,NOW(),NOW()),
              ('U011','2026-08-02','09:00','18:00',NULL,NULL,'seed',NULL,NOW(),NOW()),
              ('U011','2026-08-03','09:00','18:00',NULL,NULL,'seed',NULL,NOW(),NOW())
       ON DUPLICATE KEY UPDATE check_in = VALUES(check_in), check_out = VALUES(check_out)`
    );
    const { readPayrollAttendance } = await import('../src/domains/attendance/payrollAttendanceSource');
    const payroll = await poolModule.transaction((conn) => readPayrollAttendance(
      conn,
      [{ id: 'U001', name: '陈亦然' }, { id: 'U011', name: '黄可欣' }],
      '2026-08',
      new Set<AttendanceMetric>(['presentDays'])
    ));
    // 早班组休息日 8-02 对 U001、U011（未分配，使用第一个组）分别生效，工资出勤只计另一天。
    assert.equal(payroll.get('U001')?.presentDays, 1);
    assert.equal(payroll.get('U011')?.presentDays, 1);

    const updated = await request(`/admin/attendance/groups/${earlyId}`, admin, 'PUT', {
      ...earlySettings, name: '早班组改', employeeIds: ['U001'],
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.payload.data.employeeIds, ['U001']);
    const movedBack = await request('/attendance/settings', employee('U005'));
    assert.equal(movedBack.payload.data.startTime, '17:00');

    const movedToLate = await request(`/admin/attendance/groups/${lateId}`, admin, 'PUT', {
      ...defaultSettings, restDates: [], address: '晚班地点', name: '晚班组', employeeIds: ['U010', 'U005'],
    });
    assert.equal(movedToLate.status, 200);
    assert.deepEqual(movedToLate.payload.data.employeeIds, ['U005', 'U010']);
    const lateSettings = await request('/attendance/settings', employee('U005'));
    assert.equal(lateSettings.payload.data.address, '晚班地点');

    assert.equal((await request('/admin/attendance/groups', admin, 'POST', {
      ...earlySettings, name: '早班组改', employeeIds: ['U001'],
    })).status, 409);
    assert.equal((await request('/admin/attendance/groups', admin, 'POST', {
      ...earlySettings, name: '不存在员工组', employeeIds: ['U999'],
    })).status, 400);

    const renamed = await request(`/admin/attendance/groups/${earlyId}/name`, admin, 'PATCH', { name: '早班组改名' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.payload.data.name, '早班组改名');
    assert.equal((await request(`/admin/attendance/groups/${earlyId}/name`, admin, 'PATCH', { name: '晚班组' })).status, 409);
    assert.equal((await request(`/admin/attendance/groups/${earlyId}/name`, admin, 'PATCH', { name: '  ' })).status, 400);

    assert.equal((await request(`/admin/attendance/groups/${lateId}`, admin, 'DELETE')).status, 200);
    const lateFallback = await request('/attendance/settings', employee('U010'));
    assert.equal(lateFallback.payload.data.startTime, '17:00');
    const movedFallback = await request('/attendance/settings', employee('U005'));
    assert.equal(movedFallback.payload.data.startTime, '17:00');

    assert.equal((await request(`/admin/attendance/groups/${earlyId}`, admin, 'DELETE')).status, 200);
    const remainingGroups = await request('/admin/attendance/groups', admin);
    assert.equal(remainingGroups.payload.data.groups.length, 0);
    assert.equal(remainingGroups.payload.data.unassignedCount, 6);
    const noGroupFallback = await request('/attendance/settings', employee('U001'));
    assert.equal(noGroupFallback.payload.data.startTime, '08:00');
    assert.equal(noGroupFallback.payload.data.address, '默认地点');
    assert.equal((await request(`/admin/attendance/groups/${earlyId}`, admin, 'DELETE')).status, 404);

    const [remaining] = await connection.query(`SELECT COUNT(*) AS total FROM \`${database}\`.attendance_groups`);
    assert.equal(Number((remaining as Array<{ total: number }>)[0].total), 0);
  } finally {
    t.mock.timers.reset();
    await closeServer?.();
    await closePool?.();
    if (created) await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.end();
  }
});
