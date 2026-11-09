import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('离职确认检查审批与交接，停用账号且支持安全撤销', async () => {
  const database = `yunqi_hr_test_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema(); await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config'); const { issueTokens } = await import('../src/miniprogram/auth/authService');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve)); closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const admin = jwt.sign({ typ: 'admin', role: 'super_admin' }, config.jwt.secret, { subject: '1' }); const old = issueTokens('U001');
    const request = async (path: string, method = 'GET', body?: unknown, token = admin) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    assert.equal((await request('/admin/hr/offboarding', 'POST', { employeeId: 'U001', lastDate: '2020-01-01', note: '' })).status, 400);
    const createdExit = await request('/admin/hr/offboarding', 'POST', { employeeId: 'U001', lastDate: '2025-01-01', note: '' });
    assert.equal(createdExit.status, 200); const id = createdExit.body.data.id;
    assert.equal((await request(`/admin/hr/offboarding/${id}/finalize`, 'POST', {})).status, 400);
    assert.equal((await request(`/admin/hr/offboarding/${id}/complete`, 'POST', {})).status, 200);
    await conn.query(`INSERT INTO \`${database}\`.approval_approvers (type, employee_id, updated_by, updated_at) VALUES ('leave', 'U001', 1, NOW())`);
    assert.equal((await request(`/admin/hr/offboarding/${id}/finalize`, 'POST', {})).status, 400);
    await conn.query(`DELETE FROM \`${database}\`.approval_approvers WHERE type='leave'`);
    await conn.query(`INSERT INTO \`${database}\`.approvals (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept, applicant_position, form_json, created_at) VALUES ('TEST-EXIT','leave','请假','测试','pending',0,'U001','测试','测试','测试','[]',NOW())`);
    assert.equal((await request(`/admin/hr/offboarding/${id}/finalize`, 'POST', {})).status, 400);
    await conn.query(`UPDATE \`${database}\`.approvals SET status='approved' WHERE id='TEST-EXIT'`);
    await conn.query(`INSERT INTO \`${database}\`.approvals (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept, applicant_position, form_json, created_at) VALUES ('TEST-APPROVER','leave','请假','测试','pending',0,'U005','测试','测试','测试','[]',NOW())`);
    await conn.query(`INSERT INTO \`${database}\`.approval_timeline (approval_id, step_no, name, role, action, state, approver_id) VALUES ('TEST-APPROVER', 1, '测试', '审批人', '待审批', 'current', 'U001')`);
    assert.equal((await request(`/admin/hr/offboarding/${id}/finalize`, 'POST', {})).status, 400);
    await conn.query(`UPDATE \`${database}\`.approvals SET status='approved' WHERE id='TEST-APPROVER'`);
    await conn.query(`UPDATE \`${database}\`.employees SET join_date='2025-02-01' WHERE id='U001'`);
    assert.equal((await request(`/admin/hr/offboarding/${id}/finalize`, 'POST', {})).status, 400);
    await conn.query(`UPDATE \`${database}\`.employees SET join_date='2021-03-15' WHERE id='U001'`);
    const publishedGraph = { nodes: [{ id: 'review', kind: 'approver', position: { x: 0, y: 0 }, config: { approverIds: ['U001'] } }], edges: [], formFields: [] };
    await conn.query(`INSERT INTO \`${database}\`.custom_approval_publications (approval_type, publication_version, workflow_version, case_version, graph_json, fixed_fields_json, credentials_json, published_by, published_at) VALUES ('leave', 1, 1, 1, ?, '[]', '{}', 1, NOW())`, [JSON.stringify(publishedGraph)]);
    assert.equal((await request(`/admin/hr/offboarding/${id}/finalize`, 'POST', {})).status, 400, '已发布流程的审批人不能直接离职');
    await conn.query(`DELETE FROM \`${database}\`.custom_approval_publications WHERE approval_type='leave'`);
    assert.equal((await request(`/admin/hr/offboarding/${id}/finalize`, 'POST', {})).status, 200);
    assert.equal((await request('/admin/hr/offboarding', 'POST', { employeeId: 'U001', lastDate: '2026-01-01', note: '' })).status, 400);
    assert.equal((await request('/me', 'GET', undefined, old.accessToken)).status, 401);
    assert.equal((await request('/admin/employees/U001/account/status', 'PATCH', { status: 'active' })).status, 400);
    assert.equal((await request('/admin/hr/employee-transitions', 'POST', { employeeId: 'U001', type: 'transfer', effectiveDate: '2025-01-01', changes: { position: '测试' }, note: '' })).status, 400);
    assert.equal((await request('/admin/hr/offboarding')).body.data[0].departureStatus, 'departed');
    assert.equal((await request('/admin/hr/employees')).body.data.find((e: { id: string }) => e.id === 'U001').employmentStatus, 'departed');
    assert.equal((await request('/admin/employees/U001')).body.data.employmentStatus, 'departed');
    assert.equal((await request('/admin/dashboard')).body.data.employeeCount, 5);
    const historicalAttendance = await request('/admin/attendance?date=2025-01-01&employeeId=U001');
    assert.equal(historicalAttendance.body.data.list.length, 1);
    const laterAttendance = await request('/admin/attendance?date=2025-01-02&employeeId=U001');
    assert.equal(laterAttendance.body.data.list.length, 0);
    const other = issueTokens('U005');
    assert.equal((await request('/employees', 'GET', undefined, other.accessToken)).body.data.some((e: { id: string }) => e.id === 'U001'), false);
    assert.equal((await request(`/admin/hr/offboarding/${id}/cancel-departure`, 'POST', {})).status, 200);
    assert.equal((await request('/admin/hr/employees')).body.data.find((e: { id: string }) => e.id === 'U001').employmentStatus, 'active');
    assert.equal((await request('/admin/dashboard')).body.data.employeeCount, 6);
    assert.equal((await request('/me', 'GET', undefined, old.accessToken)).status, 401);
    assert.equal((await request('/admin/employees/U001/account/status', 'PATCH', { status: 'active' })).status, 200);
    assert.equal((await request('/me', 'GET', undefined, old.accessToken)).status, 401);
    const second = await request('/admin/hr/offboarding', 'POST', { employeeId: 'U005', lastDate: '2025-01-01', note: '' });
    assert.equal(second.status, 200); const secondId = second.body.data.id;
    assert.equal((await request(`/admin/hr/offboarding/${secondId}/complete`, 'POST', {})).status, 200);
    const concurrent = await Promise.all([
      request(`/admin/hr/offboarding/${secondId}/finalize`, 'POST', {}),
      request('/admin/approval-approvers/leave', 'PUT', { employeeId: 'U005' }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 200).length, 1);
    const [invalid] = await conn.query<any[]>(`SELECT d.id FROM \`${database}\`.hr_employee_departures d JOIN \`${database}\`.approval_approvers a ON a.employee_id=d.employee_id WHERE d.employee_id='U005' AND d.status='departed'`);
    assert.equal(invalid.length, 0);
    const third = await request('/admin/hr/offboarding', 'POST', { employeeId: 'U012', lastDate: '2025-01-01', note: '' });
    assert.equal(third.status, 200);
    assert.equal((await request(`/admin/hr/offboarding/${third.body.data.id}/complete`, 'POST', {})).status, 200);
    const graph = { version: 0, formFields: [], nodes: [
      { id: 's', kind: 'start', position: { x: 0, y: 0 } },
      { id: 'a', kind: 'approver', position: { x: 1, y: 0 }, config: { approverIds: ['U012'] } },
      { id: 'e', kind: 'end', position: { x: 2, y: 0 } },
    ], edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }] };
    assert.equal((await request('/admin/approval-workflows/purchase', 'PUT', graph)).status, 200);
    assert.equal((await request('/admin/approval-workflows/purchase/test-cases', 'PUT', { version: 0, cases: [{ id: 'one', name: '采购', values: { item: '电脑', amount: '100', needDate: '2026-01-01', reason: '测试' } }] })).status, 200);
    assert.equal((await request('/admin/approval-workflows/purchase/test', 'POST', {})).body.data.passed, true);
    const publishAndDepart = await Promise.all([
      request(`/admin/hr/offboarding/${third.body.data.id}/finalize`, 'POST', {}),
      request('/admin/approval-workflows/purchase/publish', 'POST', { workflowVersion: 1, caseVersion: 1 }),
    ]);
    assert.equal(publishAndDepart.filter(result => result.status === 200).length, 1, '发布与离职不能同时成功');
    const [publishedRows] = await conn.query<any[]>(`SELECT graph_json FROM \`${database}\`.custom_approval_publications WHERE approval_type='purchase'`);
    const [departedRows] = await conn.query<any[]>(`SELECT id FROM \`${database}\`.hr_employee_departures WHERE employee_id='U012' AND status='departed'`);
    assert.ok(!publishedRows.length || !departedRows.length, '发布流程不能保留已离职审批人');

  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
