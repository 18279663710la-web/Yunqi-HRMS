import { pinyin } from 'pinyin-pro';
import { execute, queryOne, queryRows, transaction } from '../../shared/db/pool';
import type {
  AccountStatus,
  AdminDepartmentNode,
  AdminEmployee,
  AdminEmployeeListResponse,
  EmployeeAccount,
  JobCategoryName,
} from '../../shared/types/admin';
import type { DepartmentNode } from '../../shared/types/models';
import { badRequest, notFound } from '../../shared/utils/errors';
import { hashPassword } from '../../shared/utils/password';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import type { AdminUser } from '../../shared/types/admin';
import { getDepartmentTree } from '../../domains/employees/userService';
import { assertJobTitle } from '../../domains/employees/jobTitleService';
import { assertOrganization } from '../../domains/employees/organizationService';
import { revokeEmployeeSessions } from '../../domains/accounts/employeeSessionService';
import { activateDueDepartures, unlockEmployeeAccount } from '../hr/hrDepartureService';
import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

interface EmployeeRow {
  id: string;
  name: string;
  pinyin: string;
  gender: string | null;
  dept_id: string;
  dept_name: string | null;
  position: string;
  job_category: JobCategoryName | null;
  level: string;
  employee_no: string;
  phone: string;
  email: string;
  join_date: string;
  is_leader: number;
  seat: string;
  leader_id: string | null;
  leader_name: string | null;
  login_name: string | null;
  account_status: AccountStatus | null;
  account_last_login_at: string | null;
  account_created_at: string | null;
  account_updated_at: string | null;
  departed: number;
}

const ACTIVE_EMPLOYEE = "NOT EXISTS (SELECT 1 FROM hr_employee_departures hd WHERE hd.employee_id = e.id AND hd.status = 'departed')";

const SELECT_EMPLOYEE = `
  SELECT e.*, d.name AS dept_name,
         EXISTS(SELECT 1 FROM hr_employee_departures hd WHERE hd.employee_id = e.id AND hd.status = 'departed') AS departed,
         l.name AS leader_name,
         a.login_name, a.status AS account_status,
         a.last_login_at AS account_last_login_at,
         a.created_at AS account_created_at,
         a.updated_at AS account_updated_at
  FROM employees e
  LEFT JOIN departments d ON d.id = e.dept_id
  LEFT JOIN employees l ON l.id = e.leader_id
  LEFT JOIN employee_accounts a ON a.employee_id = e.id
`;

/** 按部门归属把员工归入三类职位：研发员 / 业务员 / 员工 */
async function buildJobCategoryByDept(): Promise<Map<string, JobCategoryName>> {
  const rows = await queryRows<{ id: string; parent_id: string | null; name: string }>(
    'SELECT id, parent_id, name FROM departments'
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const result = new Map<string, JobCategoryName>();

  const resolve = (deptId: string): JobCategoryName => {
    const names: string[] = [];
    const visited = new Set<string>();
    let current = byId.get(deptId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      names.push(current.name);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    if (names.some((name) => name.includes('产品技术') || name.includes('研发'))) return '研发员';
    if (names.some((name) => name.includes('市场') || name.includes('运营'))) return '业务员';
    return '员工';
  };

  rows.forEach((row) => result.set(row.id, resolve(row.id)));
  return result;
}

function mapEmployee(row: EmployeeRow): AdminEmployee {
  let account: EmployeeAccount | null = null;
  if (row.login_name) {
    account = {
      employeeId: row.id,
      loginName: row.login_name,
      status: row.account_status || 'active',
      lastLoginAt: row.account_last_login_at ? String(row.account_last_login_at).slice(0, 16) : null,
      createdAt: row.account_created_at ? String(row.account_created_at).slice(0, 16) : '',
      updatedAt: row.account_updated_at ? String(row.account_updated_at).slice(0, 16) : '',
    };
  }
  return {
    id: row.id,
    name: row.name,
    pinyin: row.pinyin,
    gender: row.gender || undefined,
    deptId: row.dept_id,
    deptName: row.dept_name || '',
    position: row.position,
    level: row.level,
    employeeNo: row.employee_no,
    phone: row.phone,
    email: row.email,
    joinDate: row.join_date,
    isLeader: !!row.is_leader,
    seat: row.seat,
    leaderId: row.leader_id || '',
    leaderName: row.leader_name || '',
    jobCategory: row.position,
    employmentStatus: row.departed ? 'departed' : 'active',
    account,
  };
}

async function collectDeptIds(deptId: string): Promise<string[]> {
  const rows = await queryRows<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM departments'
  );
  const ids = new Set<string>([deptId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) {
        ids.add(row.id);
        changed = true;
      }
    }
  }
  return Array.from(ids);
}

export interface AdminEmployeeListParams {
  keyword?: string;
  deptId?: string;
  jobCategory?: JobCategoryName;
  accountStatus?: 'all' | 'active' | 'disabled' | 'none';
  page?: number;
  pageSize?: number;
}

async function assertEmployed(employeeId: string): Promise<void> {
  await activateDueDepartures(employeeId);
  const departed = await queryOne("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1", [employeeId]);
  if (departed) throw badRequest('员工已离职，请在离职管理中办理复职');
}

export async function getAdminEmployeeList(
  params: AdminEmployeeListParams = {}
): Promise<AdminEmployeeListResponse> {
  await activateDueDepartures();
  const where: string[] = [ACTIVE_EMPLOYEE];
  const args: unknown[] = [];

  const keyword = String(params.keyword || '').trim();
  if (keyword) {
    const like = `%${keyword}%`;
    where.push('(e.name LIKE ? OR e.pinyin LIKE ? OR e.employee_no LIKE ? OR e.phone LIKE ? OR a.login_name LIKE ?)');
    args.push(like, like, like, like, like);
  }

  if (params.deptId) {
    const ids = await collectDeptIds(params.deptId);
    where.push(`e.dept_id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }

  if (params.jobCategory) {
    where.push('e.position = ?');
    args.push(params.jobCategory);
  }

  const accountStatus = params.accountStatus || 'all';
  if (accountStatus === 'active') where.push("a.status = 'active'");
  else if (accountStatus === 'disabled') where.push("a.status = 'disabled'");
  else if (accountStatus === 'none') where.push('a.employee_id IS NULL');

  const page = Math.max(1, Math.trunc(Number(params.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(params.pageSize) || 20)));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM employees e
     LEFT JOIN employee_accounts a ON a.employee_id = e.id
     ${whereSql}`,
    args
  );

  const rows = await queryRows<EmployeeRow>(
      `${SELECT_EMPLOYEE} ${whereSql}
       ORDER BY e.is_leader DESC, e.pinyin ASC
       LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]
    );

  return {
    list: rows.map(mapEmployee),
    total: Number(countRow?.total || 0),
    page,
    pageSize,
  };
}

export async function getAdminEmployeeById(id: string): Promise<AdminEmployee | null> {
  const row = await queryOne<EmployeeRow>(`${SELECT_EMPLOYEE} WHERE e.id = ?`, [id]);
  return row ? mapEmployee(row) : null;
}

export async function getAllEmployeesForSelect(): Promise<Array<{ id: string; name: string; deptName: string; position: string; employeeNo: string; phone: string; loginName: string | null }>> {
  await activateDueDepartures();
  const rows = await queryRows<EmployeeRow>(`${SELECT_EMPLOYEE} WHERE ${ACTIVE_EMPLOYEE} ORDER BY e.pinyin ASC`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    deptName: r.dept_name || '',
    position: r.position,
    employeeNo: r.employee_no,
    phone: r.phone,
    loginName: r.login_name,
  }));
}

function employeeNamePinyin(name: string): string {
  const value = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z]/g, '');
  if (!/^[a-z]+$/.test(value) || value.length > 100) throw badRequest('姓名无法生成拼音');
  return value;
}

async function allocateEmployeeId(conn: PoolConnection): Promise<string> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT id FROM employees WHERE id REGEXP '^U[0-9]+$' FOR UPDATE");
  const max = rows.reduce((acc, row) => Math.max(acc, Number(String(row.id).slice(1)) || 0), 0);
  const id = `U${String(max + 1).padStart(3, '0')}`;
  if (id.length > 10) throw badRequest('员工编号已用完');
  return id;
}

function duplicateEmployeeNo(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return err.code === 'ER_DUP_ENTRY' && String(err.message || '').includes('employee_no');
}

async function assertDepartment(deptId: string): Promise<void> {
  const row = await queryOne<{ id: string }>('SELECT id FROM departments WHERE id = ?', [deptId]);
  if (!row) throw badRequest('部门不存在');
}

async function assertLeader(leaderId: string, employeeId: string): Promise<void> {
  if (!leaderId) return;
  if (leaderId === employeeId) throw badRequest('直属上级不能是本人');
  const row = await queryOne<{ id: string }>('SELECT id FROM employees WHERE id = ?', [leaderId]);
  if (!row) throw badRequest('直属上级不存在');
}

async function assertEmployeeNo(conn: PoolConnection, employeeNo: string, excludeId = ''): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM employees WHERE employee_no = ? AND id <> ? LIMIT 1 FOR UPDATE',
    [employeeNo, excludeId]
  );
  if (rows.length) throw badRequest('工号已存在');
}

async function resolveLeaderId(deptId: string, excludeId = ''): Promise<string | null> {
  const rows = await queryRows<{ id: string; parent_id: string | null; leader_id: string | null }>(
    'SELECT id, parent_id, leader_id FROM departments'
  );
  const map = new Map(rows.map((r) => [r.id, r]));
  let dept = map.get(deptId);
  const visited = new Set<string>();
  while (dept && !visited.has(dept.id)) {
    visited.add(dept.id);
    if (dept.leader_id && dept.leader_id !== excludeId) return dept.leader_id;
    dept = dept.parent_id ? map.get(dept.parent_id) : undefined;
  }
  return null;
}

export interface EmployeeInput {
  name: string;
  pinyin: string;
  gender?: string;
  deptId: string;
  position: string;
  jobCategory?: JobCategoryName;
  level: string;
  employeeNo: string;
  phone: string;
  email?: string;
  joinDate: string;
  isLeader?: boolean;
  seat?: string;
  leaderId?: string;
}

export interface EmployeeAccountInput {
  loginName: string;
  password: string;
  status?: AccountStatus;
}

export interface CreateEmployeeInput extends EmployeeInput {
  jobCategory: JobCategoryName;
  account?: EmployeeAccountInput;
}

export async function createEmployee(
  input: CreateEmployeeInput,
  operator: AdminUser
): Promise<AdminEmployee> {
  await assertDepartment(input.deptId);
  const namePinyin = employeeNamePinyin(input.name);
  const position = input.jobCategory || input.position;

  let account: EmployeeAccountInput | undefined;
  if (input.account) {
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(input.account.loginName)) {
      throw badRequest('登录名需为 3-30 位字母、数字、下划线、点或短横线');
    }
    const exists = await queryOne<{ employee_id: string }>(
      'SELECT employee_id FROM employee_accounts WHERE login_name = ?',
      [input.account.loginName]
    );
    if (exists) throw badRequest('该登录名已被使用');
    account = input.account;
  }

  let id = '';
  try {
  await transaction(async (conn) => {
    await assertOrganization(conn, input.deptId);
    await assertJobTitle(conn, position);
    id = await allocateEmployeeId(conn);
    const leaderId = input.leaderId || (await resolveLeaderId(input.deptId, id));
    await assertLeader(leaderId || '', id);
    await assertEmployeeNo(conn, input.employeeNo);
    await conn.query(
      `INSERT INTO employees
        (id, name, pinyin, gender, dept_id, position, job_category, level, employee_no, phone, email, join_date, is_leader, seat, leader_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        namePinyin,
        input.gender || null,
        input.deptId,
        position,
        null,
        input.level,
        input.employeeNo,
        input.phone,
        input.email || '',
        input.joinDate,
        input.isLeader ? 1 : 0,
        input.seat || '',
        leaderId,
      ]
    );

    if (account) {
      await conn.query(
        `INSERT INTO employee_accounts
          (employee_id, login_name, password_hash, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, account.loginName, hashPassword(account.password), account.status || 'active', operator.id]
      );
    }
  });
  } catch (error) {
    if (duplicateEmployeeNo(error)) throw badRequest('工号已存在');
    throw error;
  }

  await recordAdminLog(operator, '创建员工', 'employee', id, {
    name: input.name,
    deptId: input.deptId,
    account: account ? account.loginName : null,
  });

  const created = await getAdminEmployeeById(id);
  if (!created) throw new Error('员工创建失败');
  return created;
}

export async function updateEmployee(
  id: string,
  input: EmployeeInput,
  operator: AdminUser
): Promise<AdminEmployee> {
  await assertEmployed(id);
  const current = await getAdminEmployeeById(id);
  if (!current) throw notFound('员工不存在');
  await assertDepartment(input.deptId);
  await assertLeader(input.leaderId || '', id);

  const leaderId = input.leaderId || (await resolveLeaderId(input.deptId, id));
  const position = input.position;
  const namePinyin = employeeNamePinyin(input.name);

  try {
  await transaction(async (conn) => {
    await conn.query('SELECT id FROM employees WHERE id = ? FOR UPDATE', [id]);
    await assertEmployeeNo(conn, input.employeeNo, id);
    await assertOrganization(conn, input.deptId);
    await assertJobTitle(conn, position);
    await conn.execute(
    `UPDATE employees
     SET name = ?, pinyin = ?, gender = ?, dept_id = ?, position = ?, level = ?,
         employee_no = ?, phone = ?, email = ?, join_date = ?, is_leader = ?, seat = ?, leader_id = ?
     WHERE id = ?`,
    [
      input.name,
      namePinyin,
      input.gender || null,
      input.deptId,
      position,
      input.level,
      input.employeeNo,
      input.phone,
      input.email || '',
      input.joinDate,
      input.isLeader ? 1 : 0,
      input.seat || '',
      leaderId,
      id,
    ]
    );
  });
  } catch (error) {
    if (duplicateEmployeeNo(error)) throw badRequest('工号已存在');
    throw error;
  }

  await recordAdminLog(operator, '修改员工', 'employee', id, {
    before: { name: current.name, deptId: current.deptId, position: current.position },
    after: { name: input.name, deptId: input.deptId, position: input.position },
  });

  const updated = await getAdminEmployeeById(id);
  if (!updated) throw notFound('员工不存在');
  return updated;
}

async function assertLoginName(loginName: string, employeeId: string): Promise<void> {
  const row = await queryOne<{ employee_id: string }>(
    'SELECT employee_id FROM employee_accounts WHERE login_name = ? AND employee_id <> ?',
    [loginName, employeeId]
  );
  if (row) throw badRequest('该登录名已被使用');
}

async function assertAccountCanBeEnabled(conn: PoolConnection, employeeId: string): Promise<void> {
  const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1", [employeeId]);
  if (departures.length) throw badRequest('员工已离职，请先撤销离职记录');
}

export async function upsertEmployeeAccount(
  employeeId: string,
  input: EmployeeAccountInput,
  operator: AdminUser
): Promise<AdminEmployee> {
  await assertEmployed(employeeId);
  const employee = await getAdminEmployeeById(employeeId);
  if (!employee) throw notFound('员工不存在');
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(input.loginName)) {
    throw badRequest('登录名需为 3-30 位字母、数字、下划线、点或短横线');
  }
  await assertLoginName(input.loginName, employeeId);
  const passwordHash = hashPassword(input.password);

  const existed = await transaction(async (conn) => {
    await conn.query('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
    const [accounts] = await conn.query<RowDataPacket[]>('SELECT status FROM employee_accounts WHERE employee_id = ? FOR UPDATE', [employeeId]);
    const status = input.status || accounts[0]?.status || 'active';
    if (status === 'active') await assertAccountCanBeEnabled(conn, employeeId);
    if (accounts.length) {
      await conn.execute('UPDATE employee_accounts SET login_name = ?, password_hash = ?, status = ?, updated_at = NOW() WHERE employee_id = ?', [input.loginName, passwordHash, status, employeeId]);
      await revokeEmployeeSessions(conn, employeeId);
    } else {
      await conn.execute('INSERT INTO employee_accounts (employee_id, login_name, password_hash, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())', [employeeId, input.loginName, passwordHash, status, operator.id]);
    }
    return accounts.length > 0;
  });
  await recordAdminLog(operator, existed ? '更新员工账号' : '创建员工账号', 'employee', employeeId, { loginName: input.loginName });

  const updated = await getAdminEmployeeById(employeeId);
  if (!updated) throw notFound('员工不存在');
  return updated;
}

export async function setEmployeeAccountStatus(
  employeeId: string,
  status: AccountStatus,
  operator: AdminUser
): Promise<AdminEmployee> {
  await assertEmployed(employeeId);
  const employee = await getAdminEmployeeById(employeeId);
  if (!employee) throw notFound('员工不存在');
  if (!employee.account) throw badRequest('该员工尚未开通登录账号');
  await transaction(async (conn) => {
    await conn.query('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
    if (status === 'active') {
      await assertAccountCanBeEnabled(conn, employeeId);
      await unlockEmployeeAccount(conn, employeeId);
    } else {
      await conn.execute('UPDATE employee_accounts SET status = ?, updated_at = NOW() WHERE employee_id = ?', [status, employeeId]);
      await revokeEmployeeSessions(conn, employeeId);
    }
  });
  await recordAdminLog(operator, status === 'active' ? '启用员工账号' : '禁用员工账号', 'employee', employeeId, {
    loginName: employee.account.loginName,
  });
  const updated = await getAdminEmployeeById(employeeId);
  if (!updated) throw notFound('员工不存在');
  return updated;
}

export async function resetEmployeeAccountPassword(
  employeeId: string,
  password: string,
  operator: AdminUser
): Promise<void> {
  await assertEmployed(employeeId);
  const employee = await getAdminEmployeeById(employeeId);
  if (!employee) throw notFound('员工不存在');
  if (!employee.account) throw badRequest('该员工尚未开通登录账号');
  await transaction(async (conn) => {
    await conn.execute('UPDATE employee_accounts SET password_hash = ?, updated_at = NOW() WHERE employee_id = ?', [hashPassword(password), employeeId]);
    await revokeEmployeeSessions(conn, employeeId);
  });
  await recordAdminLog(operator, '重置员工密码', 'employee', employeeId, {
    loginName: employee.account.loginName,
  });
}

/** 历史员工补齐职位分类（新增列后执行一次即可；幂等） */
export async function backfillEmployeeJobCategories(): Promise<number> {
  if (await queryOne("SELECT 1 FROM app_meta WHERE `k` = 'unified_job_titles_v1'")) return 0;
  const [rows, categoryMap] = await Promise.all([
    queryRows<{ id: string; dept_id: string }>(
      'SELECT id, dept_id FROM employees WHERE job_category IS NULL'
    ),
    buildJobCategoryByDept(),
  ]);
  for (const row of rows) {
    const category = categoryMap.get(row.dept_id) || '员工';
    await execute('UPDATE employees SET job_category = ? WHERE id = ?', [category, row.id]);
  }
  return rows.length;
}

/** 部门树（带负责人姓名） */
export async function getAdminDepartmentTree(): Promise<AdminDepartmentNode[]> {
  const [tree, employees] = await Promise.all([
    getDepartmentTree(),
    queryRows<{ id: string; name: string }>('SELECT id, name FROM employees'),
  ]);
  const nameMap = new Map(employees.map((e) => [e.id, e.name]));

  const mapNode = (node: DepartmentNode): AdminDepartmentNode => ({
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    leaderId: node.leaderId,
    leaderName: nameMap.get(node.leaderId) || '',
    order: node.order,
    count: node.count,
    total: node.total,
    children: node.children.map(mapNode),
  });

  return tree.map(mapNode);
}
