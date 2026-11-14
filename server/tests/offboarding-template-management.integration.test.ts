import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('离职申请表设置已移除，模板表删除且旧交接清单表保留', async () => {
  const database = `yunqi_offboarding_tpl_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined; let closeServer: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool; await pool.ensureSchema();
    await conn.query(`CREATE TABLE \`${database}\`.hr_offboarding_form_templates (id INT PRIMARY KEY)`);
    await conn.query(`CREATE TABLE \`${database}\`.hr_offboarding_form_template_history (id BIGINT PRIMARY KEY)`);
    await conn.query(`INSERT INTO \`${database}\`.hr_settings (setting_key, value_json, updated_at) VALUES ('self_offboarding_default', '1', NOW())`);
    await pool.ensureSchema();
    const [tables] = await conn.query(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('hr_offboarding_form_templates', 'hr_offboarding_form_template_history', 'hr_offboarding')`, [database]);
    assert.deepEqual((tables as { name: string }[]).map(row => row.name).sort(), ['hr_offboarding']);
    const [settings] = await conn.query(`SELECT setting_key FROM \`${database}\`.hr_settings WHERE setting_key = 'self_offboarding_default'`);
    assert.equal((settings as unknown[]).length, 0);
    await (await import('../src/shared/db/seed')).seedDatabase(); await (await import('../src/admin/admin-accounts/adminAuthService')).ensureDefaultAdmin();
    const { config } = await import('../src/config');
    const server = (await import('../src/app')).createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
    const admin = jwt.sign({ typ: 'admin' }, config.jwt.secret, { subject: '1' });
    const call = async (path: string, method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      return response.status;
    };
    assert.equal(await call('/admin/offboarding-form/templates'), 404);
    assert.equal(await call('/admin/offboarding-form/templates', 'POST'), 404);
    assert.equal(await call('/admin/offboarding-form/template-history'), 404);
  } finally { if (closeServer) await closeServer(); if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
