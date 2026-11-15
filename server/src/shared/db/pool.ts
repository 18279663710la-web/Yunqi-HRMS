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

  // 兼容开发阶段已有的审批测试表；旧测试结果必须重新执行。
  if (!(await hasColumn('custom_approval_test_runs', 'fields_hash'))) {
    await conn.query("ALTER TABLE custom_approval_test_runs ADD COLUMN fields_hash CHAR(64) NOT NULL DEFAULT '' AFTER case_version");
  }
  if (!(await hasColumn('custom_approval_publications', 'fixed_fields_json'))) {
    const [existing] = await conn.query<mysql.RowDataPacket[]>('SELECT approval_type FROM custom_approval_publications LIMIT 1');
    if (existing.length) throw new Error('已有发布流程缺少表单快照，需先安全迁移后再启动');
    await conn.query('ALTER TABLE custom_approval_publications ADD COLUMN fixed_fields_json JSON NOT NULL AFTER graph_json');
  }

  const hasIndex = async (table: string, index: string): Promise<boolean> => {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = ? AND index_name = ? LIMIT 1`,
      [database, table, index]
    );
    return (rows as unknown[]).length > 0;
  };

  if (!(await hasIndex('approvals', 'idx_approvals_applicant_sort'))) {
    await conn.query('ALTER TABLE `approvals` ADD INDEX `idx_approvals_applicant_sort` (`applicant_id`, `urgent`, `created_at`, `id`)');
  }
  if (!(await hasIndex('approvals', 'idx_approvals_type_status_applicant'))) {
    await conn.query('ALTER TABLE `approvals` ADD INDEX `idx_approvals_type_status_applicant` (`type`, `status`, `applicant_id`)');
  }
  if (!(await hasIndex('approval_timeline', 'idx_timeline_approver_approval'))) {
    await conn.query('ALTER TABLE `approval_timeline` ADD INDEX `idx_timeline_approver_approval` (`approver_id`, `state`, `approval_id`)');
  }

  const [batchMonthIndexes] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT NON_UNIQUE AS nonUnique FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'hr_payroll_batches' AND index_name = 'idx_hr_batch_month' LIMIT 1`, [database]
  );
  if (batchMonthIndexes.length && Number(batchMonthIndexes[0].nonUnique) === 0) {
    await conn.query('ALTER TABLE hr_payroll_batches DROP INDEX idx_hr_batch_month, ADD INDEX idx_hr_batch_month (payroll_month)');
  }

  await conn.query('DELETE FROM hr_payroll_payslip_staging WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)');

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
  if (!(await hasIndex('employees', 'uk_employees_employee_no'))) {
    const [duplicates] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT employee_no FROM employees GROUP BY employee_no HAVING COUNT(*) > 1 LIMIT 1'
    );
    if (duplicates.length) throw new Error('员工工号存在重复，无法添加唯一约束');
    await conn.query('ALTER TABLE employees ADD UNIQUE KEY uk_employees_employee_no (employee_no)');
  }

  // 小程序微信一键登录绑定：openid 唯一，未绑定为 NULL（MySQL 唯一索引允许多个 NULL）。
  if (!(await hasColumn('employee_accounts', 'wx_openid'))) {
    await conn.query('ALTER TABLE `employee_accounts` ADD COLUMN `wx_openid` VARCHAR(64) NULL DEFAULT NULL AFTER `password_hash`');
  }
  if (!(await hasIndex('employee_accounts', 'uk_employee_accounts_wx_openid'))) {
    await conn.query('ALTER TABLE `employee_accounts` ADD UNIQUE INDEX `uk_employee_accounts_wx_openid` (`wx_openid`)');
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
  // 地点和楼层说明字段已移除，打卡范围仅保留坐标与半径。
  if (await hasColumn('attendance_settings', 'address')) {
    await conn.query('ALTER TABLE `attendance_settings` DROP COLUMN `address`');
  }
  if (await hasColumn('attendance_settings', 'floor')) {
    await conn.query('ALTER TABLE `attendance_settings` DROP COLUMN `floor`');
  }
  if (await hasColumn('attendance_groups', 'address')) {
    await conn.query('ALTER TABLE `attendance_groups` DROP COLUMN `address`');
  }
  if (await hasColumn('attendance_groups', 'floor')) {
    await conn.query('ALTER TABLE `attendance_groups` DROP COLUMN `floor`');
  }

  // 公司日历：老考勤组按原有休息日期生成规则并绑定，未配置的组绑定默认规则。
  const jsonArray = (value: unknown): string[] => {
    if (!value) return [];
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').sort() : [];
    } catch {
      return [];
    }
  };
  if (!(await hasColumn('attendance_groups', 'calendar_rule_id'))) {
    await conn.query('ALTER TABLE `attendance_groups` ADD COLUMN `calendar_rule_id` INT NULL AFTER `name`');
  }
  if (!(await hasIndex('attendance_groups', 'idx_attendance_group_calendar'))) {
    await conn.query('ALTER TABLE `attendance_groups` ADD INDEX `idx_attendance_group_calendar` (`calendar_rule_id`)');
  }
  const [calendarRows] = await conn.query<mysql.RowDataPacket[]>('SELECT id, rest_dates FROM company_calendar_rules ORDER BY id ASC LIMIT 1');
  const [settingsRows] = await conn.query<mysql.RowDataPacket[]>('SELECT rest_dates FROM attendance_settings WHERE id = 1');
  let defaultCalendarId: number;
  let defaultRestDates: string[];
  if (!calendarRows.length) {
    defaultRestDates = settingsRows.length ? jsonArray(settingsRows[0].rest_dates) : [];
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO company_calendar_rules
        (name, mode, weekly_rest_days, cycle_weeks, cycle_rest_days, anchor_date, rest_dates, work_dates, created_at, updated_at)
       VALUES ('默认公司日历', 'none', '[]', NULL, '[]', NULL, ?, '[]', NOW(), NOW())`,
      [JSON.stringify(defaultRestDates)]
    );
    defaultCalendarId = Number(result.insertId);
  } else {
    defaultCalendarId = Number(calendarRows[0].id);
    defaultRestDates = jsonArray(calendarRows[0].rest_dates);
  }
  const [unassignedGroups] = await conn.query<mysql.RowDataPacket[]>('SELECT id, name, rest_dates FROM attendance_groups WHERE calendar_rule_id IS NULL');
  for (const group of unassignedGroups) {
    const restDates = jsonArray(group.rest_dates);
    let ruleId = defaultCalendarId;
    if (restDates.length && JSON.stringify(restDates) !== JSON.stringify(defaultRestDates)) {
      const baseName = `${String(group.name).slice(0, 38)} 日历`;
      let name = baseName;
      const [existing] = await conn.query<mysql.RowDataPacket[]>('SELECT id FROM company_calendar_rules WHERE name = ?', [name]);
      if (existing.length) name = `${baseName} ${group.id}`.slice(0, 50);
      const [duplicate] = await conn.query<mysql.RowDataPacket[]>('SELECT id FROM company_calendar_rules WHERE name = ?', [name]);
      if (duplicate.length) {
        ruleId = Number(duplicate[0].id);
      } else {
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO company_calendar_rules
            (name, mode, weekly_rest_days, cycle_weeks, cycle_rest_days, anchor_date, rest_dates, work_dates, created_at, updated_at)
           VALUES (?, 'none', '[]', NULL, '[]', NULL, ?, '[]', NOW(), NOW())`,
          [name, JSON.stringify(restDates)]
        );
        ruleId = Number(result.insertId);
      }
    }
    await conn.query('UPDATE attendance_groups SET calendar_rule_id = ? WHERE id = ?', [ruleId, group.id]);
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

  // U9 镜像：发票号可能含多张票号拼接，需加长。
  if (await hasColumn('u9_mirror_ar_heads', 'invoice_num')) {
    const [invoiceCols] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'u9_mirror_ar_heads' AND column_name = 'invoice_num' LIMIT 1`,
      [database]
    );
    if (invoiceCols.length && Number(invoiceCols[0].len) < 500) {
      await conn.query('ALTER TABLE `u9_mirror_ar_heads` MODIFY COLUMN `invoice_num` VARCHAR(500) NOT NULL DEFAULT \'\'');
    }
  }

  // 简化离职：支持已申请/已离职，可无交接清单，可存档附件。
  if (await hasColumn('hr_employee_departures', 'offboarding_id')) {
    const [cols] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT IS_NULLABLE AS nullable FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'hr_employee_departures' AND column_name = 'offboarding_id' LIMIT 1`,
      [database]
    );
    if (cols.length && String(cols[0].nullable).toUpperCase() === 'NO') {
      await conn.query('ALTER TABLE `hr_employee_departures` MODIFY COLUMN `offboarding_id` BIGINT NULL');
    }
  }
  if (!(await hasColumn('hr_employee_departures', 'note'))) {
    await conn.query("ALTER TABLE `hr_employee_departures` ADD COLUMN `note` VARCHAR(500) NOT NULL DEFAULT '' AFTER `last_date`");
  }
  if (!(await hasColumn('hr_employee_departures', 'reinstatement_date'))) {
    await conn.query('ALTER TABLE `hr_employee_departures` ADD COLUMN `reinstatement_date` DATE NULL AFTER `last_date`');
  }
  {
    const [cols] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_TYPE AS columnType FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'hr_employee_departures' AND column_name = 'status' LIMIT 1`,
      [database]
    );
    if (cols.length && !String(cols[0].columnType).includes('applied')) {
      await conn.query("ALTER TABLE `hr_employee_departures` MODIFY COLUMN `status` ENUM('applied','departed','cancelled') NOT NULL DEFAULT 'applied'");
    }
  }

  await conn.query('DROP TABLE IF EXISTS `hr_offboarding_form_template_history`');
  await conn.query('DROP TABLE IF EXISTS `hr_offboarding_form_templates`');
  await conn.query("DELETE FROM hr_settings WHERE setting_key = 'self_offboarding_default'");

  // 特殊董事长账号下线：把旧的指定审批人配置与时间线经手记录改派给唯一的“职务=董事长”在职员工，然后删除账号表。
  {
    const [chairRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT ea.employee_id AS employee_id FROM employees e
       JOIN employee_accounts ea ON ea.employee_id = e.id
       WHERE e.position = '董事长' AND ea.status = 'active'
       GROUP BY ea.employee_id`
    );
    const chairEmployeeId = chairRows.length === 1 ? String(chairRows[0].employee_id) : null;
    if (chairEmployeeId) {
      await conn.query('UPDATE `approval_approvers` SET employee_id = ? WHERE employee_id = ?', [chairEmployeeId, 'CHAIR001']);
      await conn.query('UPDATE `approval_timeline` SET approver_id = ? WHERE approver_id = ?', [chairEmployeeId, 'CHAIR001']);
      // 流程设计稿里引用 CHAIR001 的审批人节点同样改派，并递增版本号让已打开的编辑器因乐观锁刷新到新内容。
      await conn.query(
        'UPDATE `custom_approval_workflows` SET graph_json = REPLACE(CAST(graph_json AS CHAR), \'CHAIR001\', ?), version = version + 1 WHERE graph_json LIKE \'%CHAIR001%\'',
        [chairEmployeeId]
      );
    }
    await conn.query('DROP TABLE IF EXISTS `chairperson_account`');
  }
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
