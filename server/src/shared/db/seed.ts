import type { PoolConnection } from 'mysql2/promise';

import { queryOne, transaction } from './pool';
import {
  approvalTypes as approvalTypesSeed,
  company as companySeed,
  employees as employeesSeed,
  notices as noticesSeed,
  quickActions as quickActionsSeed,
} from './seedData';
import { config } from '../../config';
import { hashPassword } from '../utils/password';
import { seedAttendanceForEmployees, seedTodayCheckIns } from './attendanceSeed';

interface SeedEmployee {
  id: string;
  name: string;
  pinyin: string;
  position: string;
  level: string;
  employeeNo: string;
  phone: string;
  email: string;
  joinDate: string;
  isLeader: boolean;
  seat: string;
}

interface SeedApprovalType {
  key: string;
  name: string;
  color: string;
  desc: string;
  fields: unknown[];
}

interface SeedQuickAction {
  key: string;
  name: string;
  icon: string;
  color: string;
  url: string;
  tab?: boolean;
}

interface SeedNotice {
  id: string;
  title: string;
  category: string;
  categoryName: string;
  isTop: boolean;
  isRead: boolean;
  publishTime: string;
  publisher: string;
  publisherDept: string;
  banner: string;
  summary: string;
  readCount: number;
  totalCount: number;
  blocks: unknown[];
  attachments: unknown[];
}

const employees = employeesSeed as SeedEmployee[];
const approvalTypes = approvalTypesSeed as SeedApprovalType[];
const quickActions = quickActionsSeed as SeedQuickAction[];
const notices = noticesSeed as unknown as SeedNotice[];

const DATA_VERSION = '1';
const READ_EMPLOYEE_ID = 'U001';

/** 生产初始化只写结构性和固定配置，不写演示员工、公告、考勤等业务数据。 */
const baseCompany = {
  name: '云启办公',
  shortName: '云启办公',
  logoText: '云启',
  address: '',
  workTime: '',
  flexible: '',
};

async function clearAll(conn: PoolConnection): Promise<void> {
  const tables = [
    'approval_workflow_ai_jobs',
    'approval_workflow_instances',
    'expense_ai_jobs',
    'expense_attachments',
    'expense_uploads',
    'admin_operation_logs',
    'approval_approvers',
    'approval_rules',
    'employee_accounts',
    'admins',
    'invoice_verifications',
    'invoice_identity_locks',
    'notice_reads',
    'invoices',
    'approval_timeline',
    'attendance_visit_photos',
    'attendance_visits',
    'attendance_overtime_punches',
    'approvals',
    'notices',
    'attendance_group_employees',
    'attendance_groups',
    'company_calendar_rules',
    'attendance_punches',
    'quick_actions',
    'approval_types',
    'employees',
    'hr_payroll_legacy_job_titles',
    'job_titles',
    'legacy_department_names',
    'departments',
    'companies',
    'app_meta',
  ];
  for (const table of tables) {
    await conn.query(`DELETE FROM \`${table}\``);
  }
}

async function insertBaseData(conn: PoolConnection): Promise<void> {
  await conn.query(
    'INSERT IGNORE INTO companies (id, name, short_name, logo_text, address, work_time, flexible) VALUES (1, ?, ?, ?, ?, ?, ?)',
    [baseCompany.name, baseCompany.shortName, baseCompany.logoText, baseCompany.address, baseCompany.workTime, baseCompany.flexible]
  );

  await conn.query("INSERT IGNORE INTO departments (id, parent_id, name, leader_id, sort_order) VALUES ('D00', NULL, '未分配', NULL, 0)");

  await conn.query(
    `INSERT IGNORE INTO company_calendar_rules
      (name, mode, weekly_rest_days, cycle_weeks, cycle_rest_days, anchor_date, rest_dates, work_dates, created_at, updated_at)
     VALUES ('默认公司日历', 'none', '[]', NULL, '[]', NULL, '[]', '[]', NOW(), NOW())`
  );

  for (let i = 0; i < approvalTypes.length; i += 1) {
    const t = approvalTypes[i];
    await conn.query(
      'INSERT IGNORE INTO approval_types (`key`, `name`, color, description, fields_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [t.key, t.name, t.color, t.desc, JSON.stringify(t.fields), i + 1]
    );
  }

  await touchMeta(conn);
}

async function insertAll(conn: PoolConnection): Promise<void> {
  await conn.query(
    'INSERT INTO companies (id, name, short_name, logo_text, address, work_time, flexible) VALUES (1, ?, ?, ?, ?, ?, ?)',
    [companySeed.name, companySeed.shortName, companySeed.logoText, companySeed.address, companySeed.workTime, companySeed.flexible]
  );

  await conn.query("INSERT INTO departments (id, parent_id, name, leader_id, sort_order) VALUES ('D00', NULL, '未分配', NULL, 0)");

  await conn.query(
    `INSERT IGNORE INTO company_calendar_rules
      (name, mode, weekly_rest_days, cycle_weeks, cycle_rest_days, anchor_date, rest_dates, work_dates, created_at, updated_at)
     VALUES ('默认公司日历', 'none', '[]', NULL, '[]', NULL, '[]', '[]', NOW(), NOW())`
  );

  for (const e of employees) {
    await conn.query(
      `INSERT INTO employees
        (id, name, pinyin, gender, dept_id, position, job_category, level, employee_no, phone, email, join_date, is_leader, seat, leader_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.id,
        e.name,
        e.pinyin,
        null,
        'D00',
        e.position,
        e.position,
        e.level,
        e.employeeNo,
        e.phone,
        e.email,
        e.joinDate,
        e.isLeader ? 1 : 0,
        e.seat,
        null,
      ]
    );
  }

  // 给保留的演示员工预置小程序登录账号（密码见 DEMO_EMPLOYEE_PASSWORD）
  const demoAccountIds = employees.map((employee) => employee.id);
  const demoPasswordHash = hashPassword(config.demoEmployeePassword);
  for (const employeeId of demoAccountIds) {
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) continue;
    await conn.query(
      `INSERT INTO employee_accounts
        (employee_id, login_name, password_hash, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NULL, NOW(), NOW())`,
      [employeeId, employee.pinyin, demoPasswordHash]
    );
  }

  for (let i = 0; i < approvalTypes.length; i += 1) {
    const t = approvalTypes[i];
    await conn.query(
      'INSERT INTO approval_types (`key`, `name`, color, description, fields_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [t.key, t.name, t.color, t.desc, JSON.stringify(t.fields), i + 1]
    );
  }

  for (let i = 0; i < quickActions.length; i += 1) {
    const q = quickActions[i];
    await conn.query(
      'INSERT INTO quick_actions (`key`, `name`, icon, color, url, is_tab, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [q.key, q.name, q.icon, q.color, q.url, q.tab ? 1 : 0, i + 1]
    );
  }

  await insertNotices(conn);
  // 完整重播保留考勤配置时，同步公司展示时间。
  await conn.query("UPDATE companies c JOIN attendance_settings s ON s.id = 1 SET c.work_time = CONCAT(s.start_time, ' - ', s.end_time) WHERE c.id = 1");
  await touchMeta(conn);
}

async function insertNotices(conn: PoolConnection): Promise<void> {
  for (const n of notices) {
    await conn.query(
      `INSERT INTO notices
        (id, title, category, category_name, is_top, publish_time, publisher, publisher_dept, banner,
         summary, read_count, total_count, blocks_json, attachments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        n.id,
        n.title,
        n.category,
        n.categoryName,
        n.isTop ? 1 : 0,
        n.publishTime,
        n.publisher,
        n.publisherDept,
        n.banner,
        n.summary,
        n.readCount,
        n.totalCount,
        JSON.stringify(n.blocks),
        JSON.stringify(n.attachments),
      ]
    );

    // 演示账号 U001 的已读状态（原 mock 里的 isRead）
    if (n.isRead) {
      await conn.query(
        'INSERT IGNORE INTO notice_reads (notice_id, employee_id, read_at) VALUES (?, ?, NOW())',
        [n.id, READ_EMPLOYEE_ID]
      );
    }
  }
}

async function touchMeta(conn: PoolConnection): Promise<void> {
  await conn.query(
    'INSERT INTO app_meta (`k`, `v`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `v` = VALUES(`v`)',
    ['data_version', DATA_VERSION]
  );
}

/**
 * 测试辅助：重置公告、考勤和查验缓存，保留审批、发票及员工账号。
 * 不对外提供接口。
 */
export async function resetDemoContent(): Promise<void> {
  await transaction(async (conn) => {
    const tables = [
      'invoice_verifications',
      'notice_reads',
      'notices',
      'attendance_punches',
    ];
    for (const table of tables) {
      await conn.query(`DELETE FROM \`${table}\``);
    }
    await insertNotices(conn);
    await touchMeta(conn);
  });

  const seedEmployeeIds = employees.map((e) => e.id);
  await seedAttendanceForEmployees(seedEmployeeIds);
  await seedTodayCheckIns(seedEmployeeIds);
}

/** 数据库初始化：只写五种固定审批类型、未分配组织、空公司配置和默认日历；管理员由 ensureDefaultAdmin 单独写入。 */
export async function initializeBaseData(force = false): Promise<boolean> {
  await transaction(async (conn) => {
    if (force) await clearAll(conn);
    await insertBaseData(conn);
  });
  return true;
}

/** 仅测试夹具使用：写入演示员工、账号、公告、快捷入口和审批类型；生产启动不调用。 */
export async function seedDemoData(force = false): Promise<boolean> {
  const row = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM companies');
  if (!force && row && Number(row.total) > 0) return false;

  await transaction(async (conn) => {
    if (force) await clearAll(conn);
    await insertAll(conn);
  });
  return true;
}
