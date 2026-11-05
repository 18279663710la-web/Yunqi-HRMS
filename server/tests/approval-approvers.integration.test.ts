import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('四类审批分别配置唯一审批人，新单流转、旧单不改派', async () => {
  const database = `yunqi_approvers_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool;
    await pool.ensureSchema();
    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/employees/adminEmployeeService')).backfillEmployeeJobCategories();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username, password_hash, name, role, status, created_at) VALUES ('hr_test', 'x', 'HR', 'hr_admin', 1, NOW())`);
    const { config } = await import('../src/config');
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' });
    const hr = jwt.sign({ typ: 'admin', role: 'hr_admin' }, config.jwt.secret, { subject: '2' });
    const applicant = issueTokens('U001').accessToken;
    const reviewer = issueTokens('U011').accessToken;
    async function request(path: string, token: string, method = 'GET', body?: unknown) {
      const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() as { data?: any; message?: string } };
    }
    const leaveForm = [
      { label: '请假类型', value: '事假' }, { label: '开始日期', value: '2026-10-28' }, { label: '开始时间', value: '09:00' },
      { label: '结束日期', value: '2026-10-28' }, { label: '结束时间', value: '18:00' }, { label: '请假时长（天）', value: '999' },
    ];
    const types = ['leave', 'overtime', 'travel', 'purchase'];
    for (const type of types) {
      assert.equal((await request(`/admin/approval-approvers/${type}`, hr)).status, 403);
      assert.equal((await request(`/admin/approval-approvers/${type}`, hr, 'PUT', { employeeId: 'U011' })).status, 403);
      assert.equal((await request(`/approvals/approvers/${type}`, applicant)).status, 400);
      assert.equal((await request('/approvals', applicant, 'POST', { type, form: type === 'leave' ? leaveForm : [] })).status, 400, '未配置审批人不能自动通过');
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'missing' })).status, 400);
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'U011' })).status, 200);
      assert.equal((await request(`/approvals/approvers/${type}`, applicant)).body.data.id, 'U011');
      const created = await request('/approvals', applicant, 'POST', { type, form: type === 'leave' ? leaveForm : [] });
      assert.equal(created.status, 200);
      assert.equal(created.body.data.status, 'pending');
      assert.equal(created.body.data.timeline[1].approverId, 'U011');
      if (type === 'leave') assert.equal(created.body.data.form.find((item: { label: string }) => item.label === '请假时长（天）').value, '1');
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'U005' })).status, 200);
      assert.equal((await request(`/approvals/${created.body.data.id}`, reviewer)).body.data.timeline[1].approverId, 'U011');
      assert.equal((await request(`/approvals/${created.body.data.id}/action`, reviewer, 'POST', { action: 'approve' })).body.data.ok, true);
      const own = await request('/approvals', issueTokens('U005').accessToken, 'POST', { type, form: type === 'leave' ? leaveForm : [] });
      assert.equal(own.body.data.canApprove, true, '按照报销规则允许审批自己的申请');
    }
    assert.equal((await request('/admin/approval-approvers/unknown', admin)).status, 400);
    assert.equal((await request('/approvals/approvers/unknown', applicant)).status, 400);
    const chair = await request('/admin/chairperson-account', admin, 'POST', { loginName: 'chair_test', password: 'test-password' });
    assert.equal(chair.status, 200);
    const loginRes = await fetch(base + '/auth/password-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'chair_test', password: 'test-password' }) });
    const login = await loginRes.json() as { data: { accessToken: string; user: { id: string } } };
    const chairToken = login.data.accessToken;
    const chairId = login.data.user.id;
    for (const type of types) {
      assert.ok((await request(`/admin/approval-approvers/${type}`, admin)).body.data.candidates.some((c: { id: string }) => c.id === chairId));
    }
    assert.ok((await request('/admin/approval-approvers/expense', admin)).body.data.candidates.every((c: { id: string }) => c.id !== chairId));
    assert.equal((await request('/admin/approval-approvers/expense', admin, 'PUT', { employeeId: chairId })).status, 400);
    assert.equal((await request('/admin/approval-approvers/leave', admin, 'PUT', { employeeId: chairId })).status, 200);
    assert.equal((await request('/approvals/leave-approver', applicant)).body.data.id, chairId);
    const chairLeave = await request('/approvals', applicant, 'POST', { type: 'leave', form: leaveForm });
    assert.equal(chairLeave.body.data.timeline[1].approverId, chairId);
    assert.equal((await request('/admin/approval-approvers/leave', admin, 'PUT', { employeeId: 'U005' })).status, 200);
    assert.equal((await request(`/approvals/${chairLeave.body.data.id}/action`, chairToken, 'POST', { action: 'approve' })).body.data.ok, true, '修改配置不会影响董事长已接收的请假单');
    for (const type of ['overtime', 'travel', 'purchase']) {
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: chairId })).status, 200);
      assert.equal((await request(`/approvals/approvers/${type}`, applicant)).body.data.id, chairId);
      const assigned = await request('/approvals', applicant, 'POST', { type });
      assert.equal(assigned.status, 200);
      assert.equal(assigned.body.data.timeline[1].approverId, chairId);
      assert.equal((await request(`/approvals/${assigned.body.data.id}`, chairToken)).status, 200);
      assert.ok((await request('/approvals?tab=pending', chairToken)).body.data.some((a: { id: string }) => a.id === assigned.body.data.id));
      assert.ok((await request('/approvals/pending-count', chairToken)).body.data >= 1);
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'U005' })).status, 200);
      assert.equal((await request(`/approvals/${assigned.body.data.id}/action`, chairToken, 'POST', { action: 'approve' })).body.data.ok, true);
      assert.ok((await request('/approvals?tab=done', chairToken)).body.data.some((a: { id: string }) => a.id === assigned.body.data.id));
      const unassigned = await request('/approvals', applicant, 'POST', { type });
      assert.equal((await request(`/approvals/${unassigned.body.data.id}`, chairToken)).status, 404);
      assert.equal((await request(`/approvals/${unassigned.body.data.id}/action`, chairToken, 'POST', { action: 'approve' })).body.data.ok, false);
    }
    assert.equal((await request('/admin/approval-approvers/purchase', admin, 'PUT', { employeeId: chairId })).status, 200);
    const unsupported = await request('/approvals', applicant, 'POST', { type: 'purchase' });
    await conn.query(`UPDATE \`${database}\`.approvals SET type = 'expense' WHERE id = ?`, [unsupported.body.data.id]);
    assert.equal((await request(`/approvals/${unsupported.body.data.id}`, chairToken)).status, 404, '董事长无权查看报销');
    assert.equal((await request(`/approvals/${unsupported.body.data.id}/action`, chairToken, 'POST', { action: 'approve' })).body.data.ok, false);
    assert.ok((await request('/approvals?tab=pending', chairToken)).body.data.every((a: { id: string }) => a.id !== unsupported.body.data.id));
    assert.equal((await request('/admin/approval-approvers/purchase', admin, 'PUT', { employeeId: 'U005' })).status, 200);
    assert.equal((await request('/admin/approval-approvers/overtime', admin, 'PUT', { employeeId: chairId })).status, 200);
    await conn.query(`UPDATE \`${database}\`.chairperson_account SET status = 'disabled' WHERE id = 1`);
    assert.equal((await request('/approvals/approvers/overtime', applicant)).status, 400, '董事长停用后不可继续提交新单');
    assert.equal((await request('/admin/approval-approvers/travel', admin, 'PUT', { employeeId: chairId })).status, 400);
    assert.ok((await request('/admin/approval-approvers/overtime', admin)).body.data.candidates.every((c: { id: string }) => c.id !== chairId));
    await conn.query(`UPDATE \`${database}\`.chairperson_account SET status = 'active' WHERE id = 1`);
    assert.equal((await request('/admin/approval-approvers/overtime', admin, 'PUT', { employeeId: 'U005' })).status, 200);
    assert.equal((await request('/approvals', chairToken, 'POST', { type: 'travel' })).status, 403);
    assert.equal((await request('/attendance/today', chairToken)).status, 403);
    await conn.query(`UPDATE \`${database}\`.employee_accounts SET status = 'disabled' WHERE employee_id = 'U005'`);
    for (const type of types) assert.equal((await request(`/approvals/approvers/${type}`, applicant)).status, 400);
    assert.equal((await request('/admin/expense-approver', admin)).body.data.approver, null, '其他类型不覆盖报销审批人');
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
