import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('一键添加按封存入职、合同和定薪筛选员工并自动计算工资', async () => {
  const database = `yunqi_payroll_auto_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDemoData(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, token: string, method = 'GET', body?: unknown) => { const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() as { data?: any; message?: string } }; };

    // 旧库的月份唯一索引可幂等迁移，且无需删除已有批次。
    await conn.query(`INSERT INTO \`${database}\`.hr_payroll_batches (payroll_month, status, created_at) VALUES ('1999-01', 'reviewed', NOW())`);
    await conn.query(`ALTER TABLE \`${database}\`.hr_payroll_batches DROP INDEX idx_hr_batch_month, ADD UNIQUE KEY idx_hr_batch_month (payroll_month)`);
    await pool.ensureSchema();
    await pool.ensureSchema();
    const [indexes] = await conn.query(`SHOW INDEX FROM \`${database}\`.hr_payroll_batches WHERE Key_name = 'idx_hr_batch_month'`);
    assert.equal((indexes as any[])[0].Non_unique, 1);
    const [oldBatches] = await conn.query(`SELECT status FROM \`${database}\`.hr_payroll_batches WHERE payroll_month = '1999-01'`);
    assert.equal((oldBatches as any[])[0].status, 'reviewed');

    const model = (await call('/admin/hr/salary-model', admin)).body.data;
    assert.equal((await call('/admin/hr/salary-model', admin, 'PUT', { version: model.version, fixedFields: ['基础薪资', '固定补贴', '绩效薪资'], extendedFields: ['加班费'] })).status, 200);
    const month = '2020-02';
    const rest = Array.from({ length: 25 }, (_, i) => `2020-02-${String(i + 5).padStart(2, '0')}`);
    await conn.query(`INSERT INTO \`${database}\`.attendance_settings (id,start_time,end_time,rest_dates,latitude,longitude,radius) VALUES (1,'09:00','18:00',?,0,0,100) ON DUPLICATE KEY UPDATE rest_dates=VALUES(rest_dates)`, [JSON.stringify(rest)]);
    await conn.query(`DELETE FROM \`${database}\`.attendance_punches WHERE punch_date BETWEEN '2020-02-01' AND '2020-02-29'`);
    for (const employee of ['U001', 'U013']) {
      const days = employee === 'U001' ? [1, 2] : [1, 2, 3, 4];
      for (const day of days) await conn.query(`INSERT INTO \`${database}\`.attendance_punches (employee_id,punch_date,check_in,check_out,source,created_at,updated_at) VALUES (?, ?, '09:00', '18:00', 'admin', NOW(), NOW())`, [employee, `2020-02-0${day}`]);
    }

    const template = JSON.stringify([{ name: '姓名', type: 'text', required: false }]);
    const answers = JSON.stringify({ __onboardingFormat: 2, values: { 姓名: '测试员工' } });
    for (const employeeId of ['U001', 'U013', 'U011', 'U012']) {
      await conn.query(`INSERT INTO \`${database}\`.hr_self_onboarding (employee_id, expected_date, template_json, answers_json, created_at, submitted_at, archived_at, archived_by) VALUES (?, '2026-11-01', ?, ?, NOW(), NOW(), NOW(), 1)`, [employeeId, template, answers]);
    }
    const complete = [
      ['U001', 'C-U001', 1000, 500, 500],
      ['U013', 'C-U013', 3000, 400, 600],
      ['U010', 'C-U010', 2000, 0, 0],
    ];
    for (const [employeeId, number, base, allowance, performance] of complete) {
      await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES (?, 'contract', ?, NOW())`, [employeeId, JSON.stringify({ number, startDate: '2026-01-01', endDate: '2027-01-01', note: '' })]);
      const salary = employeeId === 'U013'
        ? { effectiveDate: '2026-08-01', values: { 基础薪资: base, 固定补贴: allowance, 绩效薪资: performance }, base, allowance, performance, modelVersion: 2, note: '' }
        : { effectiveDate: '2026-08-01', base, allowance, performance, note: '' };
      await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES (?, 'salary', ?, NOW())`, [employeeId, JSON.stringify(salary)]);
    }
    await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES ('U011', 'salary', ?, NOW())`, [JSON.stringify({ effectiveDate: '2026-08-01', base: 1000, allowance: 0, performance: 0, note: '' })]);
    await conn.query(`INSERT INTO \`${database}\`.hr_employee_records (employee_id, section, data_json, updated_at) VALUES ('U012', 'contract', ?, NOW())`, [JSON.stringify({ number: 'C-U012', startDate: '2026-01-01', endDate: '2027-01-01', note: '' })]);

    const rules = [{ minRate: 100, maxRate: 100, adjustment: 200 }, { minRate: 90, maxRate: 100, adjustment: 0 }, { minRate: 0, maxRate: 90, adjustment: -300 }];
    assert.equal((await call('/admin/hr/attendance-payroll-rule-config-v2', admin, 'PUT', { mode: 'rate_attendance', rules })).status, 200);
    const batch = await call('/admin/hr/payroll-batches', admin, 'POST', { month }); assert.equal(batch.status, 200); const id = batch.body.data.id;

    const preview = await call(`/admin/hr/payroll-batches/${id}/auto-preview`, admin);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.month, month);
    assert.equal(preview.body.data.candidates.length, 2);
    assert.deepEqual(preview.body.data.candidates.map((candidate: any) => [candidate.employeeId, candidate.baseGross, candidate.gross, candidate.deductions, candidate.net]), [
      ['U001', 2000, 2000, 0, 2000], ['U013', 4000, 4000, 0, 4000],
    ]);
    assert.deepEqual(preview.body.data.totals, { baseGross: 6000, gross: 6000, deductions: 0, net: 6000 });
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`, admin)).body.data.length, 0);

    const added = await call(`/admin/hr/payroll-batches/${id}/auto-items`, admin, 'POST', {});
    assert.equal(added.status, 200);
    assert.equal(added.body.data.addedCount, 2);
    assert.equal(added.body.data.skippedExisting, 0);
    assert.deepEqual(added.body.data.totals, preview.body.data.totals);
    const items = (await call(`/admin/hr/payroll-batches/${id}/items`, admin)).body.data;
    assert.deepEqual(items.map((item: any) => [item.employeeId, item.baseGross, item.attendanceAdjustment, item.gross, item.deductions, item.net]), [
      ['U001', 2000, 0, 2000, 0, 2000], ['U013', 4000, 0, 4000, 0, 4000],
    ]);
    assert.ok(items.every((item: any) => item.modelSnapshot.extended[0].value === 0));

    const secondPreview = await call(`/admin/hr/payroll-batches/${id}/auto-preview`, admin);
    assert.equal(secondPreview.body.data.candidates.length, 0);
    assert.equal(secondPreview.body.data.existingCount, 2);
    const secondAdd = await call(`/admin/hr/payroll-batches/${id}/auto-items`, admin, 'POST', {});
    assert.equal(secondAdd.body.data.addedCount, 0);
    assert.equal(secondAdd.body.data.skippedExisting, 2);

    // 单独添加沿用手工选择员工的入口，不强制批量添加的合同完整性条件。
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`, admin, 'POST', { employeeId: 'U011' })).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/items`, admin)).body.data.length, 3);

    assert.equal((await call(`/admin/hr/payroll-batches/${id}/review`, admin, 'POST', {})).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/auto-preview`, admin)).status, 400);
    assert.equal((await call(`/admin/hr/payroll-batches/${id}/auto-items`, admin, 'POST', {})).status, 400);

    // 同月允许多个草稿，员工只受已复核批次限制；并发复核不可重复。
    const createBatch = async (month: string) => {
      const result = await call('/admin/hr/payroll-batches', admin, 'POST', { month });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body.data.id as number;
    };
    const a = await createBatch('2020-03');
    const b = await createBatch('2020-03');
    const c = await createBatch('2020-03');
    const addOne = (batchId: number, employeeId: string) => call(`/admin/hr/payroll-batches/${batchId}/items`, admin, 'POST', { employeeId });
    assert.equal((await addOne(a, 'U001')).status, 200);
    assert.equal((await addOne(b, 'U001')).status, 200);
    const reviews = await Promise.all([a, b].map(batchId => call(`/admin/hr/payroll-batches/${batchId}/review`, admin, 'POST', {})));
    assert.deepEqual(reviews.map(result => result.status).sort(), [200, 409]);
    assert.match(reviews.find(result => result.status === 409)!.body.message!, /已复核/);
    const previewRemaining = await call(`/admin/hr/payroll-batches/${c}/auto-preview`, admin);
    assert.equal(previewRemaining.status, 200);
    assert.deepEqual(previewRemaining.body.data.candidates.map((candidate: any) => candidate.employeeId), ['U013']);
    assert.equal(previewRemaining.body.data.reviewedCount, 1);
    const availability = await call(`/admin/hr/payroll-batches/${c}/employee-availability`, admin);
    assert.equal(availability.status, 200);
    assert.ok(availability.body.data.reviewedEmployeeIds.includes('U001'));
    assert.ok(!availability.body.data.reviewedEmployeeIds.includes('U013'));
    const rejected = await addOne(c, 'U001');
    assert.equal(rejected.status, 409);
    assert.match(rejected.body.message!, /已复核/);
    const auto = await call(`/admin/hr/payroll-batches/${c}/auto-items`, admin, 'POST', {});
    assert.equal(auto.status, 200);
    assert.equal(auto.body.data.addedCount, 1);
    assert.equal((await call(`/admin/hr/payroll-batches/${c}/items`, admin)).body.data[0].employeeId, 'U013');
    assert.equal((await call(`/admin/hr/payroll-batches/${c}/review`, admin, 'POST', {})).status, 200);
    const nextMonth = await createBatch('2020-04');
    assert.equal((await addOne(nextMonth, 'U001')).status, 200);
    const beforeReview = await createBatch('2020-05');
    const pendingPreview = await createBatch('2020-05');
    assert.equal((await addOne(beforeReview, 'U001')).status, 200);
    assert.ok((await call(`/admin/hr/payroll-batches/${pendingPreview}/auto-preview`, admin)).body.data.candidates.some((candidate: any) => candidate.employeeId === 'U001'));
    assert.equal((await call(`/admin/hr/payroll-batches/${beforeReview}/review`, admin, 'POST', {})).status, 200);
    assert.equal((await call(`/admin/hr/payroll-batches/${pendingPreview}/auto-items`, admin, 'POST', {})).body.data.addedCount, 1);
    assert.deepEqual((await call(`/admin/hr/payroll-batches/${pendingPreview}/items`, admin)).body.data.map((item: any) => item.employeeId), ['U013']);
    const raceFirst = await createBatch('2020-06');
    const raceSecond = await createBatch('2020-06');
    assert.equal((await addOne(raceFirst, 'U001')).status, 200);
    const [reviewRace, addRace] = await Promise.all([
      call(`/admin/hr/payroll-batches/${raceFirst}/review`, admin, 'POST', {}),
      addOne(raceSecond, 'U001'),
    ]);
    assert.equal(reviewRace.status, 200);
    assert.ok([200, 409].includes(addRace.status));
    if (addRace.status === 200) assert.equal((await call(`/admin/hr/payroll-batches/${raceSecond}/review`, admin, 'POST', {})).status, 409);

  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
