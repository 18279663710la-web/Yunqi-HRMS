import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';

test('旧模板表增量迁移补充名称和版本，并创建审计表且可重复执行', async () => {
  const database = `yunqi_template_migration_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false; let closePool: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    await conn.query(`CREATE TABLE \`${database}\`.hr_onboarding_form_templates (
      id INT PRIMARY KEY AUTO_INCREMENT,
      fields_json JSON NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`INSERT INTO \`${database}\`.hr_onboarding_form_templates (id, fields_json, created_at, updated_at) VALUES (1, ?, NOW(), NOW())`, [JSON.stringify([{ name: '旧字段', type: 'text', required: true }])]);
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool;
    await pool.ensureSchema();
    await pool.ensureSchema();

    const [columns] = await conn.query(`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'hr_onboarding_form_templates'`, [database]);
    const names = (columns as { name: string }[]).map(column => column.name);
    assert.ok(names.includes('name'));
    assert.ok(names.includes('version'));
    const [rows] = await conn.query(`SELECT id, name, version, fields_json FROM \`${database}\`.hr_onboarding_form_templates WHERE id = 1`);
    const template = (rows as { name: string; version: number; fields_json: unknown }[])[0];
    assert.equal(template.name, '模板1');
    assert.equal(template.version, 1);
    assert.deepEqual(typeof template.fields_json === 'string' ? JSON.parse(template.fields_json) : template.fields_json, [{ name: '旧字段', type: 'text', required: true }]);

    const [templateHistory] = await conn.query(`SHOW TABLES FROM \`${database}\` LIKE 'hr_onboarding_form_template_history'`);
    const [applicationHistory] = await conn.query(`SHOW TABLES FROM \`${database}\` LIKE 'hr_self_onboarding_edits'`);
    assert.equal((templateHistory as unknown[]).length, 1);
    assert.equal((applicationHistory as unknown[]).length, 1);
  } finally { if (closePool) await closePool(); if (created) await conn.query(`DROP DATABASE \`${database}\``); await conn.end(); }
});
