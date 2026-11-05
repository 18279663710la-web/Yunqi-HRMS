import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';

test('旧入职任务升级后保留原数据，迁移可重复执行', async () => {
  const database = `yunqi_hr_migration_${randomBytes(8).toString('hex')}`;
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' });
  let created = false;
  let closePool: (() => Promise<void>) | undefined;
  try {
    await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    await conn.query(`CREATE TABLE \`${database}\`.hr_onboarding_tasks (id BIGINT PRIMARY KEY AUTO_INCREMENT, onboarding_id BIGINT NOT NULL, title VARCHAR(100) NOT NULL, required TINYINT(1) NOT NULL DEFAULT 1, completed TINYINT(1) NOT NULL DEFAULT 0)`);
    await conn.query(`INSERT INTO \`${database}\`.hr_onboarding_tasks (onboarding_id, title, required, completed) VALUES (1, '已有任务', 1, 1)`);
    process.env.MYSQL_DATABASE = database;
    const pool = await import('../src/shared/db/pool'); closePool = pool.closePool;
    await pool.ensureSchema();
    await pool.ensureSchema();
    const rows = await pool.queryRows<{ title: string; description: string; start_date: string | null; end_date: string | null; completed: number }>('SELECT title, description, start_date, end_date, completed FROM hr_onboarding_tasks WHERE onboarding_id = 1');
    assert.deepEqual(rows, [{ title: '已有任务', description: '', start_date: null, end_date: null, completed: 1 }]);
  } finally {
    if (closePool) await closePool();
    if (created) await conn.query(`DROP DATABASE \`${database}\``);
    await conn.end();
  }
});
