import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('审批流程设计稿独立按类型保存，验证权限、节点和版本，不改变现有审批配置', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'workflow-ai-test-'));
  process.env.UPLOAD_DIR = uploadDir;
  process.env.WORKFLOW_CREDENTIAL_KEY = 'ab'.repeat(32);
  process.env.EXPENSE_AI_DRIVER = 'local';
  process.env.EXPENSE_AI_BASE_URL = 'http://127.0.0.1:1';
  process.env.VERIFY_DRIVER = 'tencent';
  process.env.TENCENTCLOUD_SECRET_ID = 'test-only';
  process.env.TENCENTCLOUD_SECRET_KEY = 'test-only';
  const { ocr } = await import('tencentcloud-sdk-nodejs-ocr');
  const verifier = ocr.v20181119.Client.prototype as any;
  const originalVerifier = verifier.VatInvoiceVerifyNew;
  verifier.VatInvoiceVerifyNew = async (request: any) => ({ Invoice: { Number: request.InvoiceNo, IsAbandoned: 'N', RedLetterInvoiceMark: false, AmountWithTax: request.Amount, AmountWithoutTax: request.Amount } });
  const database = `yunqi_workflow_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await conn.query(`ALTER TABLE \`${database}\`.custom_approval_test_runs DROP COLUMN fields_hash`);
    await conn.query(`ALTER TABLE \`${database}\`.custom_approval_publications DROP COLUMN fixed_fields_json`);
    await conn.query(`INSERT INTO \`${database}\`.custom_approval_test_runs (approval_type, workflow_version, case_version, passed, tested_by, tested_at) VALUES ('leave', 1, 1, 1, 1, NOW())`);
    await pool.ensureSchema();
    const [migrated] = await conn.query<any[]>(`SELECT fields_hash FROM \`${database}\`.custom_approval_test_runs WHERE approval_type='leave'`);
    assert.equal(migrated[0].fields_hash, '', '旧测试记录不能绕过字段版本校验');
    await conn.query(`DELETE FROM \`${database}\`.custom_approval_test_runs WHERE approval_type='leave'`);

    await (await import('../src/shared/db/seed')).seedDatabase();
    await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    await conn.query(`INSERT INTO \`${database}\`.admins (username,password_hash,name,role,status,created_at) VALUES ('hr_test','x','HR','hr_admin',1,NOW())`);
    const { config } = await import('../src/config');
    const adminRow = await pool.queryOne<{ id: number }>("SELECT id FROM admins WHERE role='super_admin' LIMIT 1"); assert.ok(adminRow);
    const hrRow = await pool.queryOne<{ id: number }>("SELECT id FROM admins WHERE username='hr_test'"); assert.ok(hrRow);
    const admin = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String(adminRow.id) });
    const hr = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: String(hrRow.id) });
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const request = async (path: string, method = 'GET', body?: unknown, token = admin) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/approval-workflows/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { data?: any } };
    };
    const [before] = await conn.query(`SELECT * FROM \`${database}\`.approval_approvers ORDER BY type`);
    assert.equal((await request('expense', 'GET', undefined, hr)).status, 403);
    assert.equal((await request('expense', 'PUT', { version: 0, nodes: [], edges: [] }, hr)).status, 403);
    assert.equal((await request('expense')).body.data.version, 0);
    const graph = { version: 0, nodes: [{ id: 'form', kind: 'form', position: { x: 50, y: 80 } }, { id: 'review', kind: 'approver', position: { x: 320, y: 80 } }], edges: [{ id: 'edge', source: 'form', target: 'review' }] };
    const saved = await request('expense', 'PUT', graph); assert.equal(saved.status, 200); assert.equal(saved.body.data.version, 1);
    assert.deepEqual((await request('expense')).body.data.nodes, graph.nodes);
    assert.equal((await request('expense', 'PUT', graph)).status, 409);
    assert.equal((await request('leave')).body.data.version, 0);
    assert.equal((await request('expense', 'PUT', { ...graph, version: 1, edges: [{ id: 'bad', source: 'form', target: 'missing' }] })).status, 400);
    assert.equal((await request('expense', 'PUT', { ...graph, version: 1, edges: [{ id: 'bad', source: 'form', target: 'form' }] })).status, 400);
    const raceGraph = { ...graph, version: 1 };
    const race = await Promise.all([request('expense', 'PUT', raceGraph), request('expense', 'PUT', raceGraph)]);
    assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
    assert.equal((await request('expense')).body.data.version, 2);
    const configured = {
      version: 2,
      formFields: [{ key: 'project', label: '项目类型', type: 'picker', required: true, options: ['内部', '客户'] }],
      nodes: [
        { id: 'start', kind: 'start', position: { x: 0, y: 0 } },
        { id: 'verify', kind: 'verify', position: { x: 200, y: 0 } },
        { id: 'branch', kind: 'branch', position: { x: 400, y: 0 } },
        { id: 'review', kind: 'approver', position: { x: 600, y: 0 }, config: { approverIds: ['U005', 'U011'] } },
        { id: 'end', kind: 'end', position: { x: 800, y: 0 }, config: { outcome: 'approved' } },
      ],
      edges: [
        { id: 'one', source: 'start', target: 'verify' }, { id: 'two', source: 'verify', target: 'branch' },
        { id: 'three', source: 'branch', target: 'review', conditions: [{ field: 'project', operator: 'eq', value: '客户' }] },
        { id: 'four', source: 'review', target: 'end' },
      ],
    };
    const withConfig = await request('expense', 'PUT', configured);
    assert.equal(withConfig.status, 200);
    const loaded = (await request('expense')).body.data;
    assert.deepEqual(loaded.formFields, configured.formFields);
    assert.deepEqual(loaded.nodes.find((node: any) => node.id === 'review').config, { approverIds: ['U005', 'U011'] });
    assert.deepEqual(loaded.edges.find((edge: any) => edge.id === 'three').conditions, configured.edges[2].conditions);
    assert.equal((await request('expense', 'PUT', { ...graph, version: 2 })).status, 409, '旧客户端不能覆盖已保存的节点配置');
    const overlap = { ...configured, version: 3, edges: [...configured.edges, { id: 'overlap', source: 'branch', target: 'end', conditions: [{ field: 'project', operator: 'eq', value: '客户' }] }] };
    assert.equal((await request('expense', 'PUT', overlap)).status, 400, '同一条件节点下不能保存重叠分支');
    assert.equal((await request('expense', 'PUT', { ...configured, version: 3, formFields: [] })).status, 400, '不能删除条件所引用的字段');
    assert.equal((await request('expense', 'PUT', { ...configured, version: 3, nodes: configured.nodes.map(node => node.id === 'review' ? { ...node, config: { approverIds: ['U005', 'U005'] } } : node) })).status, 400, '一个节点中审批人不能重复');
    assert.equal((await request('expense')).body.data.version, 3);
    const secret = 'test-only-credential-do-not-use';
    const aiGraph = { version: 3, formFields: [], nodes: [{ id: 'ai-node', kind: 'ai', position: { x: 1, y: 2 }, config: { provider: 'deepseek', model: 'example-model', baseUrl: 'https://api.example.test', rules: '规则示例' } }], edges: [], credentialUpdates: [{ nodeId: 'ai-node', apiKey: secret }] };
    const aiSaved = await request('expense', 'PUT', aiGraph);
    assert.equal(aiSaved.status, 200);
    assert.equal(aiSaved.body.data.nodes[0].config.hasApiKey, true);
    assert.ok(!JSON.stringify(aiSaved.body).includes(secret));
    const aiRead = await request('expense');
    assert.equal(aiRead.body.data.nodes[0].config.hasApiKey, true);
    assert.equal(aiRead.body.data.nodes[0].config.rules, '规则示例');
    assert.ok(!JSON.stringify(aiRead.body).includes(secret));
    const [credentials] = await conn.query<any[]>(`SELECT encrypted_key FROM \`${database}\`.custom_approval_credentials WHERE approval_type = 'expense'`);
    assert.equal(credentials.length, 1);
    assert.ok(!String(credentials[0].encrypted_key).includes(secret));
    const [storedGraph] = await conn.query<any[]>(`SELECT graph_json FROM \`${database}\`.custom_approval_workflows WHERE approval_type = 'expense'`);
    const [logs] = await conn.query<any[]>(`SELECT detail_json FROM \`${database}\`.admin_operation_logs WHERE target_type = 'custom_approval_workflows'`);
    assert.ok(!JSON.stringify(storedGraph).includes(secret));
    assert.ok(!JSON.stringify(logs).includes(secret));
    const { decryptWorkflowCredential } = await import('../src/domains/approvals/workflowCredentials');
    assert.equal(decryptWorkflowCredential(credentials[0].encrypted_key, 'ai-node'), secret);
    assert.throws(() => decryptWorkflowCredential(credentials[0].encrypted_key, 'other-node'));
    assert.equal((await request('leave', 'PUT', { ...aiGraph, version: 0 })).status, 400, '其他类型不能添加 AI 节点');
    assert.equal((await request('expense', 'PUT', aiGraph)).status, 409, '版本冲突不能覆盖凭据');
    const [afterConflict] = await conn.query<any[]>(`SELECT encrypted_key FROM \`${database}\`.custom_approval_credentials WHERE approval_type = 'expense'`);
    assert.equal(afterConflict[0].encrypted_key, credentials[0].encrypted_key);
    const aiUpdated = { version: 4, formFields: [], nodes: [{ ...aiRead.body.data.nodes[0], config: { ...aiRead.body.data.nodes[0].config, provider: 'openai-compatible', baseUrl: 'https://compatible.example.test/v1', model: 'another-model' } }], edges: [] };
    const compatible = await request('expense', 'PUT', aiUpdated);
    assert.equal(compatible.body.data.nodes[0].config.hasApiKey, true, '不更改密钥时保留原凭据');
    assert.equal(compatible.body.data.nodes[0].config.provider, 'openai-compatible');
    assert.equal((await request('expense', 'PUT', { version: 5, formFields: [], nodes: [], edges: [] })).status, 200);
    const [removedCredentials] = await conn.query<any[]>(`SELECT encrypted_key FROM \`${database}\`.custom_approval_credentials WHERE approval_type = 'expense'`);
    assert.equal(removedCredentials.length, 0, '删除节点时删除对应凭据');
    for (const [type, field, first, second] of [
      ['leave', 'leaveType', { operator: 'eq', value: '病假' }, { operator: 'eq', value: '事假' }],
      ['overtime', 'project', { operator: 'eq', value: '客户' }, { operator: 'eq', value: '内部' }],
      ['travel', 'budget', { operator: 'gte', value: '1000' }, { operator: 'lt', value: '1000' }],
      ['purchase', 'amount', { operator: 'gte', value: '1000' }, { operator: 'lt', value: '1000' }],
    ] as const) {
      const draft = { version: 0, formFields: configured.formFields, nodes: [configured.nodes[2], configured.nodes[3], configured.nodes[4]], edges: [
        { id: 'first', source: 'branch', target: 'review', conditions: [{ field, ...first }] },
        { id: 'second', source: 'branch', target: 'end', conditions: [{ field, ...second }] },
      ] };
      const savedType = await request(type, 'PUT', draft);
      assert.equal(savedType.status, 200, `${type} 可保存独立配置`);
      const restored = (await request(type)).body.data;
      assert.deepEqual(restored.formFields, draft.formFields);
      assert.deepEqual(restored.nodes, draft.nodes);
      assert.deepEqual(restored.edges, draft.edges);
      assert.equal((await request(type, 'PUT', draft)).status, 409, `${type} 版本冲突不可覆盖`);
    }
    const testCases = await request('leave/test-cases');
    assert.equal(testCases.status, 200);
    assert.equal(testCases.body.data.version, 0);
    const sampleValues = { leaveType: '事假', startDate: '2026-01-01', startClock: '09:00', endDate: '2026-01-01', endClock: '18:00', days: '1', reason: '测试' };
    const caseDocument = { version: 0, cases: [{ id: 'case-1', name: '事假', values: sampleValues }] };
    assert.equal((await request('leave/test-cases', 'PUT', caseDocument)).body.data.version, 1);
    assert.equal((await request('leave/test-cases', 'PUT', caseDocument)).status, 409);
    assert.equal((await request('leave/test-cases', 'GET', undefined, hr)).status, 403);
    const executable = { version: 0, formFields: [{ key: 'customMemo', label: '补充说明', type: 'text', required: false }], nodes: [
      { id: 's', kind: 'start', position: { x: 0, y: 0 } },
      { id: 'b', kind: 'branch', position: { x: 10, y: 0 } },
      { id: 'a', kind: 'approver', position: { x: 20, y: 0 }, config: { approverIds: ['U005', 'U011'] } },
      { id: 'e', kind: 'end', position: { x: 30, y: 0 }, config: { outcome: 'approved' } },
    ], edges: [
      { id: 'sb', source: 's', target: 'b' },
      { id: 'ba', source: 'b', target: 'a', conditions: [{ field: 'leaveType', operator: 'eq', value: '事假' }] },
      { id: 'ae', source: 'a', target: 'e' },
    ] };
    const savedExecutable = await request('leave', 'PUT', { ...executable, version: 1 });
    assert.equal(savedExecutable.status, 200);
    assert.equal((await request('leave/publish', 'POST', { workflowVersion: 2, caseVersion: 1 })).status, 400, '未测试不得发布');
    assert.equal((await request('leave/publish', 'POST', { workflowVersion: 2, caseVersion: 1 }, hr)).status, 403);
    const officialTest = await request('leave/test', 'POST', {});
    assert.equal(officialTest.status, 200);
    assert.equal(officialTest.body.data.passed, true);
    assert.equal(officialTest.body.data.workflowVersion, 2);
    assert.equal(officialTest.body.data.caseVersion, 1);
    assert.equal((await request('leave/test', 'POST', {}, hr)).status, 403);
    const { publishCustomWorkflow, readPublishedWorkflow } = await import('../src/domains/approvals/customWorkflowPublication');
    const [fixedBefore] = await conn.query<any[]>(`SELECT fields_json FROM \`${database}\`.approval_types WHERE \`key\` = 'leave'`);
    await conn.query(`UPDATE \`${database}\`.approval_types SET fields_json = ? WHERE \`key\` = 'leave'`, [JSON.stringify([])]);
    await assert.rejects(() => publishCustomWorkflow('leave', 2, 1, adminRow.id), /表单/);
    const fixedJson = typeof fixedBefore[0].fields_json === 'string' ? fixedBefore[0].fields_json : JSON.stringify(fixedBefore[0].fields_json);
    await conn.query(`UPDATE \`${database}\`.approval_types SET fields_json = ? WHERE \`key\` = 'leave'`, [fixedJson]);
    await conn.query(`UPDATE \`${database}\`.employee_accounts SET status = 'disabled' WHERE employee_id = 'U011'`);
    assert.equal((await request('leave/publish', 'POST', { workflowVersion: 2, caseVersion: 1 })).status, 400, '测试后审批人停用不得发布');
    await conn.query(`UPDATE \`${database}\`.employee_accounts SET status = 'active' WHERE employee_id = 'U011'`);
    const { issueTokens } = await import('../src/miniprogram/auth/authService');
    await conn.query(`INSERT INTO \`${database}\`.approval_approvers (type, employee_id, updated_by, updated_at) VALUES ('leave','U011',1,NOW())`);
    const legacyForm = [
      { label: '请假类型', value: '事假' }, { label: '开始日期', value: '2026-01-01' }, { label: '开始时间', value: '09:00' },
      { label: '结束日期', value: '2026-01-01' }, { label: '结束时间', value: '18:00' }, { label: '请假时长（天）', value: '1' }, { label: '请假事由', value: '测试' },
    ];
    const legacyResponse = await fetch(`http://127.0.0.1:${address.port}/api/approvals`, { method: 'POST', headers: { Authorization: `Bearer ${issueTokens('U001').accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'leave', form: legacyForm }) });
    assert.equal(legacyResponse.status, 200);
    const legacyId = (await legacyResponse.json() as { data: any }).data.id;
    await conn.query(`DELETE FROM \`${database}\`.approval_approvers WHERE type = 'leave'`);
    const publishedResponse = await request('leave/publish', 'POST', { workflowVersion: 2, caseVersion: 1 });
    assert.equal(publishedResponse.status, 200);
    const published = publishedResponse.body.data;
    assert.equal(published.workflowVersion, 2);
    assert.equal((await request('leave/publication')).body.data.publicationVersion, 1);
    const repeatedPublish = await Promise.all([request('leave/publish', 'POST', { workflowVersion: 2, caseVersion: 1 }), request('leave/publish', 'POST', { workflowVersion: 2, caseVersion: 1 })]);
    assert.deepEqual(repeatedPublish.map(item => item.body.data.publicationVersion), [1, 1], '相同版本重复发布应保持幂等');
    assert.deepEqual((await readPublishedWorkflow('leave'))?.workflow.nodes, executable.nodes);
    const typesResponse = await fetch(`http://127.0.0.1:${address.port}/api/approval-types`, { headers: { Authorization: `Bearer ${issueTokens('U001').accessToken}` } });
    const typesBody = await typesResponse.json() as { data: any[] };
    const publishedType = typesBody.data.find(item => item.key === 'leave');
    assert.equal(publishedType.workflowPublicationVersion, 1);
    assert.ok(publishedType.fields.some((field: any) => field.key === 'customMemo'));
    assert.ok(!JSON.stringify(publishedType).includes('approverIds'));
    const applicantToken = issueTokens('U001').accessToken;
    const approvalRequest = async (path: string, token: string, payload: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: response.status, body: await response.json() as { data?: any; message?: string } };
    };
    const legacyAfterPublish = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${legacyId}`, { headers: { Authorization: `Bearer ${issueTokens('U011').accessToken}` } });
    assert.equal((await legacyAfterPublish.json() as { data: any }).data.timeline[1].approverId, 'U011', '发布后旧单审批人保持原样');
    assert.equal((await approvalRequest(`/approvals/${legacyId}/action`, issueTokens('U011').accessToken, { action: 'approve' })).body.data.finished, true);
    const leavePayload = { type: 'leave', workflowPublicationVersion: 1, workflowValues: sampleValues, form: [
      { label: '请假类型', value: '事假' }, { label: '开始日期', value: '2026-01-01' }, { label: '开始时间', value: '09:00' },
      { label: '结束日期', value: '2026-01-01' }, { label: '结束时间', value: '18:00' }, { label: '请假时长（天）', value: '1' }, { label: '请假事由', value: '测试' },
    ] };
    assert.equal((await approvalRequest('/approvals', applicantToken, { ...leavePayload, workflowPublicationVersion: 9 })).status, 409);
    const createdWithFlow = await approvalRequest('/approvals', applicantToken, leavePayload);
    assert.equal(createdWithFlow.status, 200);
    assert.equal(createdWithFlow.body.data.timeline[1].approverId, 'U005');
    const movedGraph = { ...executable, version: 2, nodes: executable.nodes.map(item => item.id === 'e' ? { ...item, position: { x: 31, y: 0 } } : item) };
    assert.equal((await request('leave', 'PUT', movedGraph)).status, 200);
    assert.equal((await request('leave/test', 'POST', {})).body.data.passed, true);
    assert.equal((await publishCustomWorkflow('leave', 3, 1, adminRow.id)).publicationVersion, 2);
    assert.equal((await approvalRequest('/approvals', applicantToken, leavePayload)).status, 409, '旧表单版本不得发起新单');
    const firstAction = await approvalRequest(`/approvals/${createdWithFlow.body.data.id}/action`, issueTokens('U005').accessToken, { action: 'approve' });
    assert.equal(firstAction.body.data.ok, true);
    assert.equal(firstAction.body.data.finished, false);
    const secondAction = await approvalRequest(`/approvals/${createdWithFlow.body.data.id}/action`, issueTokens('U011').accessToken, { action: 'approve' });
    assert.equal(secondAction.body.data.ok, true);
    assert.equal(secondAction.body.data.finished, true);


    for (const scenario of [
      { type: 'overtime', values: { date: '2026-01-01', startTime: '18:00', endTime: '20:00', reason: '测试', project: '甲' },
        fields: [{ key: 'project', label: '项目', type: 'picker', required: true, options: ['甲', '乙'] }], condition: { field: 'project', operator: 'eq', value: '甲' }, unmatched: { project: '乙' } },
      { type: 'travel', values: { city: '上海', startDate: '2026-01-01', endDate: '2026-01-02', budget: '100', reason: '测试' },
        fields: [], condition: { field: 'budget', operator: 'gte', value: '100' }, unmatched: { budget: '1' } },
      { type: 'purchase', values: { item: '电脑', amount: '100', needDate: '2026-01-02', reason: '测试' },
        fields: [], condition: { field: 'amount', operator: 'gte', value: '100' }, unmatched: { amount: '1' } },
    ]) {
      const scenarioGraph = { ...executable, version: 1, formFields: scenario.fields,
        nodes: executable.nodes.map(node => node.id === 'e' && scenario.type === 'purchase' ? { ...node, config: { outcome: 'rejected' } } : node),
        edges: executable.edges.map(edge => edge.id === 'ba' ? { ...edge, conditions: [scenario.condition] } : edge) };
      assert.equal((await request(scenario.type, 'PUT', scenarioGraph)).status, 200);
      assert.equal((await request(`${scenario.type}/test-cases`, 'PUT', { version: 0, cases: [{ id: 'case', name: '正常', values: scenario.values }] })).status, 200);
      assert.equal((await request(`${scenario.type}/test`, 'POST', {})).body.data.passed, true);
      const release = await request(`${scenario.type}/publish`, 'POST', { workflowVersion: 2, caseVersion: 1 });
      assert.equal(release.status, 200);
      const created = await approvalRequest('/approvals', applicantToken, { type: scenario.type, workflowPublicationVersion: release.body.data.publicationVersion, workflowValues: scenario.values, form: [] });
      assert.equal(created.status, 200, `${scenario.type} 可按发布流程提交`);
      if (scenario.type === 'overtime') assert.equal(created.body.data.form.find((field: any) => field.label === '补偿方式').value, '加班费');
      const unmatchedResult = await approvalRequest('/approvals', applicantToken, { type: scenario.type, workflowPublicationVersion: release.body.data.publicationVersion, workflowValues: { ...scenario.values, ...scenario.unmatched }, form: [] });
      assert.equal(unmatchedResult.status, 400);
      assert.match(unmatchedResult.body.message || '', /未匹配/);
      assert.equal((await approvalRequest(`/approvals/${created.body.data.id}/action`, issueTokens('U005').accessToken, { action: 'approve' })).body.data.finished, false);
      assert.equal((await approvalRequest(`/approvals/${created.body.data.id}/action`, issueTokens('U011').accessToken, { action: 'approve' })).body.data.finished, true);
      const finishedResponse = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${created.body.data.id}`, { headers: { Authorization: `Bearer ${applicantToken}` } });
      assert.equal((await finishedResponse.json() as { data: any }).data.status, scenario.type === 'purchase' ? 'rejected' : 'approved');
    }
    await request('leave/test-cases', 'PUT', { version: 1, cases: [{ ...caseDocument.cases[0], values: { ...sampleValues, leaveType: '病假' } }] });
    assert.equal((await request('leave/test', 'POST', {})).body.data.passed, false, '未匹配分支不得测试通过');
    await assert.rejects(() => publishCustomWorkflow('leave', 3, 2, adminRow.id), /测试/);
    const probes: Array<{ method?: string; authorization?: string }> = [];
    let modelFails = true;
    let modelRequests = 0;
    const seenModels: string[] = [];
    const probeServer = http.createServer((req, res) => {
      if (req.method === 'GET') { probes.push({ method: req.method, authorization: req.headers.authorization }); res.writeHead(404); res.end(); return; }
      modelRequests += 1;
      let requestBody = '';
      req.on('data', chunk => { requestBody += String(chunk); });
      req.on('end', () => {
        seenModels.push(String((JSON.parse(requestBody) as { model?: string }).model));
        if (modelFails) { res.writeHead(503); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ recommendation: 'approve', reason: '材料齐全', ruleIds: ['R1'], missingAttachments: [], attachmentIssues: [] }) } }] }));
      });
    });
    await new Promise<void>(resolve => probeServer.listen(0, '127.0.0.1', resolve));
    try {
      const probeAddress = probeServer.address(); assert.ok(probeAddress && typeof probeAddress !== 'string');
      const expenseGraph = { version: 6, formFields: [], nodes: [
        { id: 'start-ai', kind: 'start', position: { x: 0, y: 0 } },
        { id: 'test-ai', kind: 'ai', position: { x: 10, y: 0 }, config: { provider: 'openai-compatible', model: 'test-model', baseUrl: `http://127.0.0.1:${probeAddress.port}`, rules: '测试规则' } },
        { id: 'review-ai', kind: 'approver', position: { x: 20, y: 0 }, config: { approverIds: ['U005'] } },
        { id: 'end-ai', kind: 'end', position: { x: 30, y: 0 }, config: { outcome: 'approved' } },
        { id: 'verify-ai', kind: 'verify', position: { x: 5, y: 0 } },
      ], edges: [
        { id: 's-v', source: 'start-ai', target: 'verify-ai' }, { id: 'v-ai', source: 'verify-ai', target: 'test-ai' }, { id: 'ai-a', source: 'test-ai', target: 'review-ai' }, { id: 'a-e', source: 'review-ai', target: 'end-ai' },
      ], credentialUpdates: [{ nodeId: 'test-ai', apiKey: secret }] };
      assert.equal((await request('expense', 'PUT', expenseGraph)).status, 200);
      const expenseCases = { version: 0, cases: [{ id: 'expense-case', name: '普通报销', values: { expenseType: '办公用品', amount: '100', date: '2026-01-01', reason: '测试', __invoice: '已提供', __attachments: '未提供' } }] };
      assert.equal((await request('expense/test-cases', 'PUT', expenseCases)).status, 200);
      const expenseTest = await request('expense/test', 'POST', {});
      assert.equal(expenseTest.status, 200);
      assert.equal(expenseTest.body.data.passed, true);
      assert.deepEqual(probes, [{ method: 'GET', authorization: undefined }]);
      const expensePublished = await publishCustomWorkflow('expense', 7, 1, adminRow.id);
      assert.ok(!JSON.stringify(expensePublished).includes(secret));
      const publishedExpenseRead = await readPublishedWorkflow('expense');
      assert.equal(publishedExpenseRead?.workflow.nodes.find(node => node.id === 'test-ai')?.config?.hasApiKey, true);
      assert.ok(!JSON.stringify(publishedExpenseRead).includes(secret));
      assert.equal((await request('expense', 'PUT', { version: 7, formFields: [], nodes: [], edges: [] })).status, 200);
      const [snapshots] = await conn.query<any[]>(`SELECT credentials_json FROM \`${database}\`.custom_approval_publications WHERE approval_type = 'expense'`);
      assert.ok(!JSON.stringify(snapshots).includes(secret));
      assert.ok(JSON.stringify(snapshots).includes('test-ai'), '修改设计稿后已发布凭据快照应保留');
      const expensePayload = { type: 'expense', workflowPublicationVersion: expensePublished.publicationVersion,
        workflowValues: { expenseType: '办公用品', amount: '10', date: '2026-01-01', reason: '测试' }, form: [],
        invoices: [{ id: 'runtime-invoice', invoiceCode: '', invoiceNumber: '12345678901234567890', invoiceDate: '2026-01-01', invoiceType: '普通发票', amount: 10, taxAmount: 0, totalAmount: 10 }] };
      const expenseCreated = await approvalRequest('/approvals', applicantToken, expensePayload);
      assert.equal(expenseCreated.status, 200);
      assert.equal(expenseCreated.body.data.status, 'pending');
      assert.equal(expenseCreated.body.data.timeline[1].role, '系统查验');
      assert.equal(expenseCreated.body.data.timeline[1].state, 'done');
      assert.equal(expenseCreated.body.data.timeline[2].role, 'AI 审批');
      assert.equal(expenseCreated.body.data.timeline[2].state, 'current');
      assert.equal(modelRequests, 0, '申请提交不应同步调用模型');
      const newerGraph = { ...expenseGraph, version: 8, nodes: expenseGraph.nodes.map(node => node.id === 'test-ai' ? { ...node, config: { ...node.config, model: 'new-model' } } : node), credentialUpdates: [{ nodeId: 'test-ai', apiKey: 'new-test-key' }] };
      assert.equal((await request('expense', 'PUT', newerGraph)).status, 200);
      assert.equal((await request('expense/test', 'POST', {})).body.data.passed, true);
      assert.equal((await publishCustomWorkflow('expense', 9, 1, adminRow.id)).publicationVersion, 2);

      const aiWorker = await import('../src/domains/approvals/workflowAiWorker');
      for (let i = 0; i < 3; i++) await aiWorker.processWorkflowAiQueue();
      const expenseId = expenseCreated.body.data.id;
      const detail = async (token: string) => (await (await fetch(`http://127.0.0.1:${address.port}/api/approvals/${expenseId}`, { headers: { Authorization: `Bearer ${token}` } })).json() as { data: any }).data;
      assert.equal((await detail(applicantToken)).aiRetryAvailable, true);
      const outsiderToken = issueTokens('U010').accessToken;
      assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/approvals/${expenseId}`, { headers: { Authorization: `Bearer ${outsiderToken}` } })).status, 404);
      assert.equal((await approvalRequest(`/approvals/${expenseId}/retry-ai`, outsiderToken, {})).status, 400);
      const retries = await Promise.all([approvalRequest(`/approvals/${expenseId}/retry-ai`, applicantToken, {}), approvalRequest(`/approvals/${expenseId}/retry-ai`, applicantToken, {})]);
      assert.deepEqual(retries.map(item => item.status).sort(), [200, 400]);
      modelFails = false;
      await aiWorker.processWorkflowAiQueue();
      const reviewerToken = issueTokens('U005').accessToken;
      const reviewerDetail = await detail(reviewerToken);
      assert.equal(reviewerDetail.canApprove, true);
      assert.equal(reviewerDetail.aiAdvice.status, 'completed');
      assert.equal(reviewerDetail.aiAdvice.advice.recommendation, 'approve');
      assert.ok(seenModels.every(model => model === 'test-model'), '旧单应使用提交时的 AI 模型快照');
      assert.equal((await approvalRequest(`/approvals/${expenseId}/action`, reviewerToken, { action: 'approve' })).body.data.ok, true);
      const secondApproverToken = issueTokens('U012').accessToken;
      const afterHumanAi = { ...expenseGraph, version: 9, nodes: [expenseGraph.nodes[0],
        { id: 'first-human', kind: 'approver', position: { x: 5, y: 0 }, config: { approverIds: ['U011'] } }, expenseGraph.nodes[4], expenseGraph.nodes[1],
        { id: 'chair-review', kind: 'approver', position: { x: 20, y: 0 }, config: { approverIds: ['U012'] } }, expenseGraph.nodes[3],
      ], edges: [{ id: 'sh', source: 'start-ai', target: 'first-human' }, { id: 'hv', source: 'first-human', target: 'verify-ai' }, { id: 'va', source: 'verify-ai', target: 'test-ai' },
        { id: 'ac', source: 'test-ai', target: 'chair-review' }, { id: 'ce', source: 'chair-review', target: 'end-ai' }] };
      assert.equal((await request('expense', 'PUT', afterHumanAi)).status, 200);
      assert.equal((await request('expense/test', 'POST', {})).body.data.passed, true);
      const secondPublication = await publishCustomWorkflow('expense', 10, 1, adminRow.id);
      const secondExpense = await approvalRequest('/approvals', applicantToken, { ...expensePayload, workflowPublicationVersion: secondPublication.publicationVersion,
        invoices: [{ ...expensePayload.invoices[0], id: 'second-runtime-invoice', invoiceNumber: '12345678901234567891' }] });
      assert.equal(secondExpense.status, 200);
      const secondId = secondExpense.body.data.id;
      assert.equal(secondExpense.body.data.timeline[1].approverId, 'U011');
      const firstReviewer = issueTokens('U011').accessToken;
      const handoff = await approvalRequest(`/approvals/${secondId}/action`, firstReviewer, { action: 'approve' });
      assert.equal(handoff.body.data.finished, false);
      const afterHandoff = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${secondId}`, { headers: { Authorization: `Bearer ${firstReviewer}` } });
      const handoffDetail = (await afterHandoff.json() as { data: any }).data;
      assert.equal(handoffDetail.flowVisible, true);
      assert.equal(handoffDetail.timeline.find((node: any) => node.role === '系统查验').state, 'done');
      assert.equal(handoffDetail.timeline.find((node: any) => node.role === 'AI 审批').state, 'current');
      const applicantHandoff = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${secondId}`, { headers: { Authorization: `Bearer ${applicantToken}` } });
      const applicantHandoffDetail = (await applicantHandoff.json() as { data: any }).data;
      assert.equal(applicantHandoffDetail.flowVisible, false, '申请人且非参与人不应看到流转过程');
      assert.deepEqual(applicantHandoffDetail.timeline, []);
      assert.equal(applicantHandoffDetail.node, '');
      modelFails = true;
      for (let i = 0; i < 3; i++) await aiWorker.processWorkflowAiQueue();
      const secondApproverRetry = await approvalRequest(`/approvals/${secondId}/retry-ai`, secondApproverToken, {});
      assert.equal(secondApproverRetry.status, 200);
      modelFails = false;
      await aiWorker.processWorkflowAiQueue();
      const secondApproverDetail = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${secondId}`, { headers: { Authorization: `Bearer ${secondApproverToken}` } });
      assert.equal(secondApproverDetail.status, 200);
      assert.equal((await secondApproverDetail.json() as { data: any }).data.canApprove, true);
      assert.equal((await approvalRequest(`/approvals/${secondId}/action`, secondApproverToken, { action: 'approve' })).body.data.ok, true);
      const cancelledExpense = await approvalRequest('/approvals', applicantToken, { ...expensePayload, workflowPublicationVersion: secondPublication.publicationVersion,
        invoices: [{ ...expensePayload.invoices[0], id: 'cancelled-runtime-invoice', invoiceNumber: '12345678901234567892' }] });
      assert.equal(cancelledExpense.status, 200);
      assert.equal((await approvalRequest(`/approvals/${cancelledExpense.body.data.id}/cancel`, applicantToken, {})).body.data.ok, true);
      const cancelledDetail = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${cancelledExpense.body.data.id}`, { headers: { Authorization: `Bearer ${applicantToken}` } });
      const cancelledData = (await cancelledDetail.json() as { data: any }).data;
      assert.equal(cancelledData.flowVisible, false);
      assert.deepEqual(cancelledData.timeline, []);
      const callsBeforeCancelledJob = modelRequests;
      await aiWorker.processWorkflowAiQueue();
      assert.equal(modelRequests, callsBeforeCancelledJob, '撤销申请不能触发待执行 AI 节点');
      await conn.query(`UPDATE \`${database}\`.approval_workflow_ai_jobs SET status = 'queued' WHERE approval_id = ?`, [cancelledExpense.body.data.id]);
      await aiWorker.processWorkflowAiQueue();
      assert.equal(modelRequests, callsBeforeCancelledJob, '不属于当前节点的排队任务不能调用模型');

      const interrupted = await approvalRequest('/approvals', applicantToken, { ...expensePayload, workflowPublicationVersion: secondPublication.publicationVersion,
        invoices: [{ ...expensePayload.invoices[0], id: 'interrupted-runtime-invoice', invoiceNumber: '12345678901234567893' }] });
      assert.equal(interrupted.status, 200);
      const interruptedId = interrupted.body.data.id;
      assert.equal((await approvalRequest(`/approvals/${interruptedId}/action`, firstReviewer, { action: 'approve' })).body.data.ok, true);
      await conn.query(`UPDATE \`${database}\`.approval_workflow_ai_jobs SET status = 'processing', attempts = 3, updated_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE approval_id = ?`, [interruptedId]);
      const callsBeforeRecovery = modelRequests;
      await aiWorker.processWorkflowAiQueue();
      const recovered = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${interruptedId}`, { headers: { Authorization: `Bearer ${applicantToken}` } });
      assert.equal((await recovered.json() as { data: any }).data.aiRetryAvailable, true);
      assert.equal(modelRequests, callsBeforeRecovery, '耗尽次数的中断任务等待手动重试');
      assert.equal((await approvalRequest(`/approvals/${interruptedId}/cancel`, applicantToken, {})).body.data.ok, true);
      const missingFile = '/uploads/workflow-missing-test.jpg';
      await conn.query(`INSERT INTO \`${database}\`.expense_uploads (file_id, owner_id, created_at) VALUES (?, 'U001', NOW())`, [missingFile]);
      const missingFileApproval = await approvalRequest('/approvals', applicantToken, { ...expensePayload, workflowPublicationVersion: secondPublication.publicationVersion,
        attachments: [{ name: '测试附件', fileID: missingFile }], invoices: [{ ...expensePayload.invoices[0], id: 'missing-file-invoice', invoiceNumber: '12345678901234567894' }] });
      assert.equal(missingFileApproval.status, 200);
      const missingFileId = missingFileApproval.body.data.id;
      assert.equal((await approvalRequest(`/approvals/${missingFileId}/action`, firstReviewer, { action: 'approve' })).body.data.ok, true);
      const beforeMissingFile = modelRequests;
      for (let i = 0; i < 3; i++) await aiWorker.processWorkflowAiQueue();
      const missingDetail = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${missingFileId}`, { headers: { Authorization: `Bearer ${applicantToken}` } });
      assert.equal((await missingDetail.json() as { data: any }).data.aiRetryAvailable, true, '无法读取材料时不应跳过 AI 节点');
      assert.equal(modelRequests, beforeMissingFile);
      assert.equal((await approvalRequest(`/approvals/${missingFileId}/cancel`, applicantToken, {})).body.data.ok, true);

      const rejectedExpense = await approvalRequest('/approvals', applicantToken, { ...expensePayload, workflowPublicationVersion: secondPublication.publicationVersion,
        invoices: [{ ...expensePayload.invoices[0], id: 'rejected-runtime-invoice', invoiceNumber: '12345678901234567895' }] });
      assert.equal(rejectedExpense.status, 200);
      const rejectedId = rejectedExpense.body.data.id;
      assert.equal((await approvalRequest(`/approvals/${rejectedId}/action`, firstReviewer, { action: 'reject', comment: '预算不足，请下月再提交' })).body.data.ok, true);
      const rejectedApplicant = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${rejectedId}`, { headers: { Authorization: `Bearer ${applicantToken}` } });
      const rejectedData = (await rejectedApplicant.json() as { data: any }).data;
      assert.equal(rejectedData.status, 'rejected');
      assert.equal(rejectedData.statusText, '已驳回');
      assert.equal(rejectedData.flowVisible, false);
      assert.deepEqual(rejectedData.timeline, []);
      assert.equal(rejectedData.finalComment, '预算不足，请下月再提交');





    } finally { await new Promise<void>((resolve, reject) => probeServer.close(error => error ? reject(error) : resolve())); }

    assert.equal((await request('leave/test-cases', 'PUT', { version: 2, cases: [{ ...caseDocument.cases[0], values: sampleValues }] })).status, 200);
    assert.equal((await request('leave/test', 'POST', {})).body.data.passed, true);
    assert.equal((await publishCustomWorkflow('leave', 3, 3, adminRow.id)).publicationVersion, 3);
    const revisedFields = [...JSON.parse(fixedJson), { key: 'extraOptional', label: '附加信息', type: 'text', required: false }];
    await conn.query(`UPDATE \`${database}\`.approval_types SET fields_json = ? WHERE \`key\` = 'leave'`, [JSON.stringify(revisedFields)]);
    assert.equal((await request('leave/test', 'POST', {})).body.data.passed, true);
    assert.equal((await publishCustomWorkflow('leave', 3, 3, adminRow.id)).publicationVersion, 4, '固定表单变化并重新测试后应生成新的发布版本');
    assert.equal((await publishCustomWorkflow('leave', 3, 3, adminRow.id)).publicationVersion, 4);

    assert.equal((await request('unknown')).status, 400);
    const [after] = await conn.query(`SELECT * FROM \`${database}\`.approval_approvers ORDER BY type`);
    assert.deepEqual(after, before);
  } finally {
    verifier.VatInvoiceVerifyNew = originalVerifier;
    if (closeServer) await closeServer(); if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end();
    await rm(uploadDir, { recursive: true, force: true });
  }
});
