import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { approvals } from '../src/shared/db/seedData';

test('只清除明确匹配的模拟审批及其关联数据，保留不匹配的单据', async () => {
  const database = `yunqi_seed_test_${randomBytes(8).toString('hex')}`;
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  try {
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool');
    closePool = pool.closePool;
    await pool.ensureSchema();
    const [seed, changed] = approvals;
    const insert = `INSERT INTO \`${database}\`.approvals (id, type, type_name, title, status, urgent, applicant_id, applicant_name, applicant_dept, applicant_position, node, summary, form_json, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, '', '', '[]', ?)`;
    await connection.query(insert, [seed.id, seed.type, seed.typeName, seed.title, seed.applicantId, seed.applicantName, seed.applicantDept, seed.applicantPosition, seed.createdAt]);
    await connection.query(insert, [changed.id, changed.type, changed.typeName, '非模拟的其他申请', changed.applicantId, changed.applicantName, changed.applicantDept, changed.applicantPosition, changed.createdAt]);
    await connection.query(`INSERT INTO \`${database}\`.approval_timeline (approval_id, step_no, name, role, action, state) VALUES (?, 1, '申请人', '申请人', '提交', 'done'), (?, 1, '申请人', '申请人', '提交', 'done')`, [seed.id, changed.id]);
    await connection.query(`INSERT INTO \`${database}\`.invoices (id, approval_id, created_at) VALUES ('seed-invoice', ?, NOW()), ('other-invoice', ?, NOW())`, [seed.id, changed.id]);
    const { findSeedApprovals, removeSeedApprovals } = await import('../src/shared/db/seedApprovalCleanup');
    assert.deepEqual(await findSeedApprovals(), [seed.id]);
    assert.equal(await removeSeedApprovals(), 1);
    const [remaining] = await connection.query(`SELECT id FROM \`${database}\`.approvals`);
    assert.deepEqual((remaining as Array<{ id: string }>).map((item) => item.id), [changed.id]);
    const [timeline] = await connection.query(`SELECT approval_id FROM \`${database}\`.approval_timeline`);
    assert.deepEqual((timeline as Array<{ approval_id: string }>).map((item) => item.approval_id), [changed.id]);
    const [invoices] = await connection.query(`SELECT id FROM \`${database}\`.invoices`);
    assert.deepEqual((invoices as Array<{ id: string }>).map((item) => item.id), ['other-invoice']);
    assert.equal(await removeSeedApprovals(), 0);
  } finally {
    if (closePool) await closePool();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
