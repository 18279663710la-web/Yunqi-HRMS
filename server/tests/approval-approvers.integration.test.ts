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
    let overtimeDay = 0;
    const approvalForm = (type: string) => {
      if (type === 'leave') return leaveForm;
      if (type !== 'overtime') return [];
      overtimeDay += 1;
      return [
        { label: '加班日期', value: `2026-11-${String(overtimeDay).padStart(2, '0')}` },
        { label: '开始时间', value: '18:00' },
        { label: '结束时间', value: '20:00' },
      ];
    };
    for (const type of types) {
      assert.equal((await request(`/admin/approval-approvers/${type}`, hr)).status, 403);
      assert.equal((await request(`/admin/approval-approvers/${type}`, hr, 'PUT', { employeeId: 'U011' })).status, 403);
      assert.equal((await request('/approvals', applicant, 'POST', { type, form: approvalForm(type) })).status, 400, '未配置审批人不能自动通过');
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'missing' })).status, 400);
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'U011' })).status, 200);
      const created = await request('/approvals', applicant, 'POST', { type, form: approvalForm(type) });
      assert.equal(created.status, 200);
      assert.equal(created.body.data.status, 'pending');
      assert.equal(created.body.data.timeline[1].approverId, 'U011');
      if (type === 'leave') assert.equal(created.body.data.form.find((item: { label: string }) => item.label === '请假时长（天）').value, '1');
      if (type === 'overtime') {
        assert.deepEqual(created.body.data.form.filter((item: { label: string }) => item.label === '补偿方式'), [{ label: '补偿方式', value: '加班费' }]);
        await conn.query(`INSERT INTO \`${database}\`.approvals (id,type,type_name,title,status,applicant_id,applicant_name,applicant_dept,applicant_position,form_json,created_at) VALUES ('HISTORIC_OT','overtime','加班','历史加班','approved','U001','员工','','员工',?,NOW())`, [JSON.stringify([{ label: '补偿方式', value: '调休' }])]);
        const [historyBefore] = await conn.query(`SELECT id, form_json FROM \`${database}\`.approvals WHERE id = 'HISTORIC_OT'`);
        const legacy = await request('/approvals', applicant, 'POST', { type, summary: '2026-10-28 加班，补偿方式：调休', form: [
          { label: '加班日期', value: '2026-10-28' }, { label: '开始时间', value: '18:00' }, { label: '结束时间', value: '20:00' },
          { label: '补偿方式', value: '调休' }, { label: '补偿方式', value: '调休' },
        ] });
        assert.equal(legacy.status, 200);
        assert.deepEqual(legacy.body.data.form.filter((item: { label: string }) => item.label === '补偿方式'), [{ label: '补偿方式', value: '加班费' }]);
        assert.equal(legacy.body.data.summary, '2026-10-28 加班，补偿方式：加班费');
        const [historyAfter] = await conn.query(`SELECT id, form_json FROM \`${database}\`.approvals WHERE id = 'HISTORIC_OT'`);
        assert.deepEqual(historyAfter, historyBefore);
      }
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'U005' })).status, 200);
      assert.equal((await request(`/approvals/${created.body.data.id}`, reviewer)).body.data.timeline[1].approverId, 'U011');
      assert.equal((await request(`/approvals/${created.body.data.id}/action`, reviewer, 'POST', { action: 'approve' })).body.data.ok, true);
      const own = await request('/approvals', issueTokens('U005').accessToken, 'POST', { type, form: approvalForm(type) });
      assert.equal(own.body.data.canApprove, true, '按照报销规则允许审批自己的申请');
    }
    assert.equal((await request('/admin/approval-approvers/unknown', admin)).status, 400);
    const secondApprover = issueTokens('U012').accessToken;
    for (const type of [...types, 'expense']) {
      const path = `/admin/approval-workflows/${type}/approver-candidates`;
      assert.equal((await request(path, hr)).status, 403);
      assert.ok((await request(path, admin)).body.data.candidates.some((c: { id: string }) => c.id === 'U012'), `${type} 独立设计稿候选为启用了小程序账号的员工`);
    }
    assert.equal((await request('/admin/approval-workflows/unknown/approver-candidates', admin)).status, 400);
    const expenseDraft = { version: 0, formFields: [], nodes: [{ id: 'review', kind: 'approver', position: { x: 0, y: 0 }, config: { approverIds: ['U012'] } }], edges: [] };
    assert.equal((await request('/admin/approval-workflows/expense', admin, 'PUT', expenseDraft)).status, 200);
    assert.deepEqual((await request('/admin/approval-workflows/expense', admin)).body.data.nodes[0].config.approverIds, ['U012']);
    for (const type of types) {
      assert.ok((await request(`/admin/approval-approvers/${type}`, admin)).body.data.candidates.some((c: { id: string }) => c.id === 'U012'));
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'U012' })).status, 200);
      const assigned = await request('/approvals', applicant, 'POST', { type, form: approvalForm(type) });
      assert.equal(assigned.status, 200);
      assert.equal(assigned.body.data.timeline[1].approverId, 'U012');
      assert.equal((await request(`/approvals/${assigned.body.data.id}`, secondApprover)).status, 200);
      assert.ok((await request('/approvals?tab=pending', secondApprover)).body.data.some((a: { id: string }) => a.id === assigned.body.data.id));
      assert.ok((await request('/approvals/pending-count', secondApprover)).body.data >= 1);
      assert.equal((await request(`/admin/approval-approvers/${type}`, admin, 'PUT', { employeeId: 'U005' })).status, 200);
      assert.equal((await request(`/approvals/${assigned.body.data.id}/action`, secondApprover, 'POST', { action: 'approve' })).body.data.ok, true, '修改配置不会影响审批人已接收的申请');
      assert.ok((await request('/approvals?tab=done', secondApprover)).body.data.some((a: { id: string }) => a.id === assigned.body.data.id));
      const unassigned = await request('/approvals', applicant, 'POST', { type, form: approvalForm(type) });
      assert.equal((await request(`/approvals/${unassigned.body.data.id}`, secondApprover)).status, 404);
      assert.equal((await request(`/approvals/${unassigned.body.data.id}/action`, secondApprover, 'POST', { action: 'approve' })).body.data.ok, false);
    }
    assert.equal((await request('/admin/approval-approvers/purchase', admin, 'PUT', { employeeId: 'U005' })).status, 200);
    await conn.query(`UPDATE \`${database}\`.employee_accounts SET status = 'disabled' WHERE employee_id = 'U005'`);
    for (const type of types) assert.equal((await request('/approvals', applicant, 'POST', { type, form: approvalForm(type) })).status, 400);
    assert.equal((await request('/admin/approval-approvers/expense', admin)).body.data.approver, null, '其他类型不覆盖报销审批人');
  } finally {
    if (closeServer) await closeServer();
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
