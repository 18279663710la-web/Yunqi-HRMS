import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('审批流程设计稿独立按类型保存，验证权限、节点和版本，不改变现有审批配置', async () => {
  const database = `yunqi_workflow_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
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
    assert.equal((await request('expense', 'PUT', { ...graph, version: 3 })).status, 409, '旧客户端不能覆盖已保存的节点配置');
    const overlap = { ...configured, version: 3, edges: [...configured.edges, { id: 'overlap', source: 'branch', target: 'end', conditions: [{ field: 'project', operator: 'eq', value: '客户' }] }] };
    assert.equal((await request('expense', 'PUT', overlap)).status, 400, '同一条件节点下不能保存重叠分支');
    assert.equal((await request('expense', 'PUT', { ...configured, version: 3, formFields: [] })).status, 400, '不能删除条件所引用的字段');
    assert.equal((await request('expense', 'PUT', { ...configured, version: 3, nodes: configured.nodes.map(node => node.id === 'review' ? { ...node, config: { approverIds: ['U005', 'U005'] } } : node) })).status, 400, '一个节点中审批人不能重复');
    assert.equal((await request('expense')).body.data.version, 3);
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
    assert.equal((await request('unknown')).status, 400);
    const [after] = await conn.query(`SELECT * FROM \`${database}\`.approval_approvers ORDER BY type`);
    assert.deepEqual(after, before);
  } finally {
    if (closeServer) await closeServer(); if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end();
  }
});
