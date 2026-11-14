import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('请假使用后台指定审批人，只有被指定的审批人可以处理申请', async () => {
  const database = `yunqi_leave_test_${randomBytes(8).toString('hex')}`;
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
    const [seededApprovals] = await connection.query(`SELECT COUNT(*) AS total FROM \`${database}\`.approvals`);
    assert.equal((seededApprovals as Array<{ total: number }>)[0].total, 0);
    const { backfillEmployeeJobCategories } = await import('../src/admin/employees/adminEmployeeService');
    await backfillEmployeeJobCategories();
    await (await import('../src/domains/employees/jobTitleService')).backfillJobTitles();
    const { ensureDefaultAdmin } = await import('../src/admin/admin-accounts/adminAuthService');
    await ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const { createApp } = await import('../src/app');
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    async function request(path: string, token = '', method = 'GET', body?: unknown) {
      const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, payload: await response.json() as { data?: any; message?: string } };
    }
    const validLeave = { type: 'leave', title: '伪造 99 天', summary: '伪造 99 天', form: [
      { label: '请假类型', value: '事假' }, { label: '开始日期', value: '2026-10-28' },
      { label: '开始时间', value: '00:00' }, { label: '结束日期', value: '2026-10-29' },
      { label: '结束时间', value: '12:00' }, { label: '请假时长（天）', value: '99' },
      { label: '请假事由', value: '测试' },
    ] };
    const [rows] = await connection.query(`SELECT id, job_category, is_leader FROM \`${database}\`.employees ORDER BY id`);
    const employees = rows as Array<{ id: string; job_category: string; is_leader: number }>;
    const worker = employees.find((e) => e.job_category === '研发员' && !e.is_leader);
    const leader = employees.find((e) => e.job_category === '研发员' && e.is_leader);
    assert.ok(worker && leader);
    const workerToken = issueTokens(worker.id).accessToken;
    const leaderToken = issueTokens(leader.id).accessToken;
    assert.equal((await request('/approvals', leaderToken, 'POST', validLeave)).status, 400);
    assert.equal((await request('/admin/approval-approvers/leave', admin, 'PUT', { employeeId: leader.id })).status, 200);
    assert.equal((await request('/approvals', workerToken, 'POST', { type: 'leave' })).status, 400);
    const invalidLeave = { ...validLeave, form: validLeave.form.map((item) => item.label === '结束日期' ? { ...item, value: '2026-10-27' } : item) };
    assert.equal((await request('/approvals', workerToken, 'POST', invalidLeave)).status, 400);
    const leave = await request('/approvals', workerToken, 'POST', validLeave);
    assert.equal(leave.status, 200);
    assert.equal(leave.payload.data.form.find((item: { label: string }) => item.label === '请假时长（天）').value, '2');
    assert.match(leave.payload.data.title, /2 天/);
    assert.match(leave.payload.data.summary, /2 天/);
    const shortLeave = { ...validLeave, form: validLeave.form.map((item) => {
      if (item.label === '开始时间') return { ...item, value: '09:00' };
      if (item.label === '结束日期') return { ...item, value: '2026-10-28' };
      if (item.label === '结束时间') return { ...item, value: '18:00' };
      return item;
    }) };
    const shortResponse = await request('/approvals', workerToken, 'POST', shortLeave);
    assert.equal(shortResponse.status, 200);
    assert.equal(shortResponse.payload.data.form.find((item: { label: string }) => item.label === '请假时长（天）').value, '1');
    assert.equal(leave.payload.data.applicantPosition, worker.job_category);
    assert.equal(leave.payload.data.timeline[1].approverId, leader.id);
    const stranger = employees.find((item) => item.id !== worker.id && item.id !== leader.id);
    assert.ok(stranger);
    const strangerToken = issueTokens(stranger.id).accessToken;
    assert.equal((await request('/approvals/' + leave.payload.data.id, strangerToken)).status, 404);
    assert.equal((await request(`/approvals/${leave.payload.data.id}/action`, leaderToken, 'POST', { action: 'approve' })).payload.data.ok, true);
    assert.equal((await request('/approvals?tab=done', workerToken)).payload.data.some((item: { id: string }) => item.id === leave.payload.data.id), true);
    assert.equal((await request('/approvals?tab=done', leaderToken)).payload.data.some((item: { id: string }) => item.id === leave.payload.data.id), true);
    assert.equal((await request('/approvals?tab=done', strangerToken)).payload.data.some((item: { id: string }) => item.id === leave.payload.data.id), false);
    assert.equal((await request('/approvals/' + leave.payload.data.id, strangerToken)).status, 404);
    await connection.query(`UPDATE \`${database}\`.approvals SET applicant_position = '旧岗位名称' WHERE id = ?`, [leave.payload.data.id]);
    assert.equal((await request('/approvals/' + leave.payload.data.id, workerToken)).payload.data.applicantPosition, worker.job_category);
    assert.equal((await request('/admin/approval-approvers/leave', admin, 'PUT', { employeeId: stranger.id })).status, 200);
    const leaderLeave = await request('/approvals', leaderToken, 'POST', validLeave);
    assert.equal(leaderLeave.status, 200);
    assert.equal(leaderLeave.payload.data.timeline[1].approverId, stranger.id);
    assert.equal((await request('/approvals/' + leave.payload.data.id, strangerToken)).status, 404);
    const pending = await request('/approvals?tab=pending', strangerToken);
    assert.equal(pending.payload.data.length, 1);
    assert.equal(pending.payload.data[0].id, leaderLeave.payload.data.id);
    const actions = await Promise.all([
      request(`/approvals/${leaderLeave.payload.data.id}/action`, strangerToken, 'POST', { action: 'approve' }),
      request(`/approvals/${leaderLeave.payload.data.id}/action`, strangerToken, 'POST', { action: 'reject', comment: '请补充资料' }),
    ]);
    assert.equal(actions.filter((action) => action.payload.data.ok).length, 1);
    const secondLeave = await request('/approvals', leaderToken, 'POST', validLeave);
    const cancelAndApprove = await Promise.all([
      request(`/approvals/${secondLeave.payload.data.id}/action`, strangerToken, 'POST', { action: 'approve' }),
      request(`/approvals/${secondLeave.payload.data.id}/cancel`, leaderToken, 'POST', {}),
    ]);
    assert.equal(cancelAndApprove.filter((result) => result.payload.data.ok).length, 1);
    const doneList = (await request('/approvals?tab=done', strangerToken)).payload.data as Array<{ id: string; form?: unknown; timeline?: unknown; invoices?: unknown }>;
    assert.ok(doneList.length > 0);
    assert.ok(doneList.every((item) => item.form === undefined && item.timeline === undefined && item.invoices === undefined));
    for (const item of doneList) {
      const detail = (await request('/approvals/' + item.id, strangerToken)).payload.data as { timeline: Array<{ approverId?: string }> };
      assert.ok(detail.timeline.some((node) => node.approverId === stranger.id));
    }
    assert.equal((await request('/admin/approval-approvers/travel', admin, 'PUT', { employeeId: worker.id })).status, 200);
    const otherType = await request('/approvals', leaderToken, 'POST', { type: 'travel' });
    assert.equal(otherType.status, 200);
    assert.equal(otherType.payload.data.applicantPosition, leader.job_category);
    assert.equal(otherType.payload.data.timeline[1].approverId, worker.id, '其他类型不受请假审批人配置影响');
    await connection.query(`UPDATE \`${database}\`.employees SET job_category = '业务员' WHERE id = ?`, [leader.id]);
    assert.equal((await request('/approvals/' + otherType.payload.data.id, leaderToken)).payload.data.applicantPosition, leader.job_category);
    const { resetDemoContent } = await import('../src/shared/db/seed');
    await resetDemoContent();
    assert.equal((await request('/approvals/' + leave.payload.data.id, workerToken)).status, 200);
    assert.equal((await request('/approvals/' + otherType.payload.data.id, leaderToken)).status, 200);
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
