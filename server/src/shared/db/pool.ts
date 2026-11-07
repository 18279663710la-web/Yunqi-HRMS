import fs from 'node:fs';
import path from 'node:path';
import mysql, { Connection, PoolConnection, ResultSetHeader } from 'mysql2/promise';

import { config } from '../../config';

const { host, port, user, password, database, connectionLimit } = config.mysql;

export const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  dateStrings: true,
  decimalNumbers: true,
  supportBigNumbers: true,
});

/** 建库（连接时不指定 database） */
export async function ensureDatabase(): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`MYSQL_DATABASE 只能包含字母、数字和下划线：${database}`);
  }
  const conn = await mysql.createConnection({ host, port, user, password, multipleStatements: false });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await conn.end();
  }
}

/** 执行 sql/schema.sql（幂等：全部 CREATE TABLE IF NOT EXISTS） */
export async function ensureSchema(): Promise<void> {
  const schemaPath = path.join(config.serverRoot, 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci',
  });
  try {
    await conn.query(sql);
    await runMigrations(conn);
  } finally {
    await conn.end();
  }
}

/**
 * 针对已经存在的数据库做增量迁移。
 * MySQL 不支持 ADD COLUMN IF NOT EXISTS，因此查 information_schema 保证幂等。
 */
async function runMigrations(conn: Connection): Promise<void> {
  const hasColumn = async (table: string, column: string): Promise<boolean> => {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1`,
      [database, table, column]
    );
    return (rows as unknown[]).length > 0;
  };

  const hasIndex = async (table: string, index: string): Promise<boolean> => {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = ? AND index_name = ? LIMIT 1`,
      [database, table, index]
    );
    return (rows as unknown[]).length > 0;
  };

  const [batchMonthIndexes] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT NON_UNIQUE AS nonUnique FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'hr_payroll_batches' AND index_name = 'idx_hr_batch_month' LIMIT 1`, [database]
  );
  if (batchMonthIndexes.length && Number(batchMonthIndexes[0].nonUnique) === 0) {
    await conn.query('ALTER TABLE hr_payroll_batches DROP INDEX idx_hr_batch_month, ADD INDEX idx_hr_batch_month (payroll_month)');
  }

  for (const [column, definition] of [
    ['base_gross', 'DECIMAL(12,2) NULL'],
    ['attendance_rate', 'DECIMAL(5,2) NULL'],
    ['attendance_adjustment', 'DECIMAL(12,2) NOT NULL DEFAULT 0'],
    ['attendance_snapshot', 'JSON NULL'],
    ['overtime_seconds', 'BIGINT NOT NULL DEFAULT 0'],
    ['overtime_pay', 'DECIMAL(12,2) NOT NULL DEFAULT 0'],
    ['overtime_snapshot', 'JSON NULL'],
    ['model_snapshot', 'JSON NULL'],
  ] as const) {
    if (!(await hasColumn('hr_payroll_batch_items', column))) await conn.query(`ALTER TABLE hr_payroll_batch_items ADD COLUMN \`${column}\` ${definition}`);
  }
  if (!(await hasColumn('hr_payroll_records', 'batch_id'))) {
    await conn.query('ALTER TABLE `hr_payroll_records` ADD COLUMN `batch_id` BIGINT NULL AFTER `employee_id`');
  }
  if (!(await hasColumn('employees', 'job_category'))) {
    await conn.query("ALTER TABLE `employees` ADD COLUMN `job_category` ENUM('研发员','业务员','员工') NULL AFTER `position`");
  }
  if (!(await hasColumn('hr_onboarding_tasks', 'description'))) {
    await conn.query("ALTER TABLE `hr_onboarding_tasks` ADD COLUMN `description` VARCHAR(500) NOT NULL DEFAULT ''");
  }
  if (!(await hasColumn('hr_onboarding_tasks', 'start_date'))) {
    await conn.query('ALTER TABLE `hr_onboarding_tasks` ADD COLUMN `start_date` DATE NULL');
  }
  if (!(await hasColumn('hr_onboarding_tasks', 'end_date'))) {
    await conn.query('ALTER TABLE `hr_onboarding_tasks` ADD COLUMN `end_date` DATE NULL');
  }
  if (!(await hasColumn('attendance_settings', 'in_end_time'))) {
    await conn.query('ALTER TABLE `attendance_settings` ADD COLUMN `in_end_time` CHAR(5) NULL AFTER `start_time`');
  }
  if (!(await hasColumn('attendance_settings', 'out_end_time'))) {
    await conn.query('ALTER TABLE `attendance_settings` ADD COLUMN `out_end_time` CHAR(5) NULL AFTER `end_time`');
  }
  if (!(await hasColumn('attendance_settings', 'rest_dates'))) {
    await conn.query('ALTER TABLE `attendance_settings` ADD COLUMN `rest_dates` JSON NULL AFTER `out_end_time`');
  }
  if (!(await hasColumn('attendance_punches', 'status_override'))) {
    await conn.query("ALTER TABLE `attendance_punches` ADD COLUMN `status_override` ENUM('leave','absent','rest') NULL AFTER `check_out`");
  }
  if (!(await hasColumn('attendance_punches', 'note'))) {
    await conn.query('ALTER TABLE `attendance_punches` ADD COLUMN `note` VARCHAR(200) NULL AFTER `status_override`');
  }
  if (!(await hasColumn('attendance_punches', 'source'))) {
    await conn.query("ALTER TABLE `attendance_punches` ADD COLUMN `source` ENUM('employee','admin','seed') NOT NULL DEFAULT 'employee' AFTER `note`");
  }
  if (!(await hasColumn('attendance_punches', 'updated_by_admin_id'))) {
    await conn.query('ALTER TABLE `attendance_punches` ADD COLUMN `updated_by_admin_id` INT NULL AFTER `source`');
  }
  if (!(await hasIndex('attendance_punches', 'idx_attendance_date'))) {
    await conn.query('ALTER TABLE `attendance_punches` ADD INDEX `idx_attendance_date` (`punch_date`)');
  }
  if (!(await hasColumn('hr_self_onboarding', 'archived_at'))) {
    await conn.query('ALTER TABLE `hr_self_onboarding` ADD COLUMN `archived_at` DATETIME NULL AFTER `submitted_at`');
  }
  if (!(await hasColumn('hr_self_onboarding', 'archived_by'))) {
    await conn.query('ALTER TABLE `hr_self_onboarding` ADD COLUMN `archived_by` INT NULL AFTER `archived_at`');
  }
  if (!(await hasColumn('hr_onboarding_form_templates', 'name'))) {
    await conn.query("ALTER TABLE `hr_onboarding_form_templates` ADD COLUMN `name` VARCHAR(50) NOT NULL DEFAULT '' AFTER `id`");
  }
  if (!(await hasColumn('hr_onboarding_form_templates', 'version'))) {
    await conn.query('ALTER TABLE `hr_onboarding_form_templates` ADD COLUMN `version` INT NOT NULL DEFAULT 1 AFTER `fields_json`');
  }
  await conn.query("UPDATE `hr_onboarding_form_templates` SET `name` = CONCAT('模板', `id`) WHERE `name` = ''");

  // 旧打回记录没有模板快照：先保存原申请模板，再仅更新仍待重填的申请。
  if (!(await hasColumn('hr_self_onboarding_submissions', 'template_json'))) {
    await conn.query('ALTER TABLE `hr_self_onboarding_submissions` ADD COLUMN `template_json` JSON NULL AFTER `answers_json`');
  }
  await conn.beginTransaction();
  try {
    const [pending] = await conn.query<mysql.RowDataPacket[]>(`SELECT s.id FROM hr_self_onboarding s
      WHERE s.submitted_at IS NULL AND EXISTS (SELECT 1 FROM hr_self_onboarding_submissions h WHERE h.onboarding_id = s.id AND h.template_json IS NULL) FOR UPDATE`);
    let activeTemplate: unknown;
    if (pending.length) {
      const [active] = await conn.query<mysql.RowDataPacket[]>(`SELECT t.fields_json FROM hr_onboarding_form_templates t
        WHERE t.id = (SELECT CAST(JSON_UNQUOTE(value_json) AS UNSIGNED) FROM hr_settings WHERE setting_key = 'self_onboarding_default') LIMIT 1`);
      const [fallback] = active.length ? [active] : await conn.query<mysql.RowDataPacket[]>('SELECT fields_json FROM hr_onboarding_form_templates ORDER BY id LIMIT 1');
      if (!fallback.length) throw new Error('无法迁移待重填申请：没有可用的入职模板');
      activeTemplate = typeof fallback[0].fields_json === 'string' ? fallback[0].fields_json : JSON.stringify(fallback[0].fields_json);
    }
    await conn.query('UPDATE hr_self_onboarding_submissions h JOIN hr_self_onboarding s ON s.id = h.onboarding_id SET h.template_json = s.template_json WHERE h.template_json IS NULL');
    if (pending.length) await conn.query('UPDATE hr_self_onboarding SET template_json = ? WHERE submitted_at IS NULL AND id IN (?)', [activeTemplate, pending.map(row => row.id)]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }

}

export async function queryRows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await queryRows<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.query(sql, params);
  return result as ResultSetHeader;
}

export async function transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
