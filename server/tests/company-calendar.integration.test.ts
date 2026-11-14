import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('公司日历支持多条规则、校验、使用保护和权限', async () => {
  const database = `yunqi_calendar_test_${randomBytes(8).toString('hex')}`;
  assert.match(database, /^yunqi_calendar_test_[0-9a-f]{16}$/);
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
    await connection.query(`INSERT INTO \`${database}\`.admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'x', 'HR', 'hr_admin', 1, NOW())`);
    const { config } = await import('../src/config');
    const { createApp } = await import('../src/app');
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hrAdmin = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const request = async (path: string, token: string, method = 'GET', body?: unknown) => {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, payload: await response.json() as { data?: any; message?: string } };
    };

    const list = await request('/admin/models-formulas/calendar-rules', admin);
    assert.equal(list.status, 200);
    assert.equal(list.payload.data.length, 1);
    assert.equal(list.payload.data[0].name, '默认公司日历');
    // 考勤组编辑需要读取日历，普通管理员可读；维护仍仅限超级管理员。
    assert.equal((await request('/admin/models-formulas/calendar-rules', hrAdmin)).status, 200);
    assert.equal((await request('/admin/models-formulas/calendar-rules', hrAdmin, 'POST', {
      name: '越权日历', mode: 'none', weeklyRestDays: [], cycleWeeks: null, cycleRestDays: [],
      anchorDate: null, restDates: [], workDates: [],
    })).status, 403);

    const weekly = await request('/admin/models-formulas/calendar-rules', admin, 'POST', {
      name: '双休日历', mode: 'weekly', weeklyRestDays: [6, 0],
      cycleWeeks: null, cycleRestDays: [], anchorDate: null,
      restDates: ['2026-10-01'], workDates: ['2026-10-10'],
    });
    assert.equal(weekly.status, 200);
    assert.equal(weekly.payload.data.mode, 'weekly');
    assert.deepEqual(weekly.payload.data.weeklyRestDays, [0, 6]);

    const duplicate = await request('/admin/models-formulas/calendar-rules', admin, 'POST', {
      name: '双休日历', mode: 'none', weeklyRestDays: [], cycleWeeks: null, cycleRestDays: [],
      anchorDate: null, restDates: [], workDates: [],
    });
    assert.equal(duplicate.status, 409);

    const invalidCycle = await request('/admin/models-formulas/calendar-rules', admin, 'POST', {
      name: '无效轮换', mode: 'cycle', weeklyRestDays: [], cycleWeeks: 2, cycleRestDays: [[6, 0]],
      anchorDate: '2026-08-03', restDates: [], workDates: [],
    });
    assert.equal(invalidCycle.status, 400);

    const overlapping = await request('/admin/models-formulas/calendar-rules', admin, 'POST', {
      name: '冲突日期', mode: 'none', weeklyRestDays: [], cycleWeeks: null, cycleRestDays: [],
      anchorDate: null, restDates: ['2026-10-01'], workDates: ['2026-10-01'],
    });
    assert.equal(overlapping.status, 400);

    const cycle = await request('/admin/models-formulas/calendar-rules', admin, 'POST', {
      name: '大小周日历', mode: 'cycle', weeklyRestDays: [], cycleWeeks: 2, cycleRestDays: [[6, 0], [0]],
      anchorDate: '2026-08-03', restDates: [], workDates: [],
    });
    assert.equal(cycle.status, 200);
    const cycleId = cycle.payload.data.id as number;

    const updated = await request(`/admin/models-formulas/calendar-rules/${cycleId}`, admin, 'PUT', {
      name: '大小周日历改', mode: 'cycle', weeklyRestDays: [], cycleWeeks: 2, cycleRestDays: [[6], [0]],
      anchorDate: '2026-08-03', restDates: ['2026-10-01'], workDates: [],
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.data.name, '大小周日历改');
    assert.deepEqual(updated.payload.data.cycleRestDays, [[6], [0]]);

    const group = await request('/admin/attendance/groups', admin, 'POST', {
      name: '日历使用组', calendarRuleId: cycleId, employeeIds: [],
      startTime: '09:00', inEndTime: '09:50', endTime: '17:40', outEndTime: '19:50',
      latitude: 23.1, longitude: 113.3, radius: 100,
    });
    assert.equal(group.status, 200);
    assert.equal(group.payload.data.calendarRuleName, '大小周日历改');
    const spare = await request('/admin/models-formulas/calendar-rules', admin, 'POST', {
      name: '并发日历', mode: 'none', weeklyRestDays: [], cycleWeeks: null, cycleRestDays: [],
      anchorDate: null, restDates: [], workDates: [],
    });
    assert.equal(spare.status, 200);
    const spareId = spare.payload.data.id as number;
    const hold = await poolModule.pool.getConnection();
    await hold.beginTransaction();
    await hold.query('SELECT id FROM company_calendar_rules WHERE id = ? FOR UPDATE', [spareId]);
    const attaching = request('/admin/attendance/groups', admin, 'POST', {
      name: '并发挂接组', calendarRuleId: spareId, employeeIds: [],
      startTime: '09:00', inEndTime: '09:50', endTime: '17:40', outEndTime: '19:50',
      latitude: 23.1, longitude: 113.3, radius: 100,
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    await hold.query('DELETE FROM company_calendar_rules WHERE id = ?', [spareId]);
    await hold.commit();
    hold.release();
    const attached = await attaching;
    assert.equal(attached.status, 400);
    assert.match(attached.payload.message || '', /有效的公司日历/);
    assert.equal((await request(`/admin/models-formulas/calendar-rules/${cycleId}`, admin, 'DELETE')).status, 409);
    assert.equal((await request(`/admin/attendance/groups/${group.payload.data.id}`, admin, 'DELETE')).status, 200);
    assert.equal((await request(`/admin/models-formulas/calendar-rules/${cycleId}`, admin, 'DELETE')).status, 200);
  } finally {
    await closeServer?.();
    await closePool?.();
    if (created) await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.end();
  }
});
