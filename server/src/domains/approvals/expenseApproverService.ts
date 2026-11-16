import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { RowDataPacket } from 'mysql2';
import type { AdminUser } from '../../shared/types/admin';
import { badRequest } from '../../shared/utils/errors';
import { recordAdminLog } from '../audit/adminLogService';

export const APPROVAL_APPROVER_TYPES = ['leave', 'expense', 'overtime', 'travel', 'purchase'] as const;
export type ApprovalApproverType = typeof APPROVAL_APPROVER_TYPES[number];
const LABELS: Record<ApprovalApproverType, string> = { leave: '请假', expense: '报销', overtime: '加班', travel: '出差', purchase: '采购' };

interface EmployeeRow {
  id: string;
  name: string;
  employee_no: string;
  job_category: string | null;
  account_status: string | null;
}

interface Candidate { id: string; name: string; employeeNo: string; jobCategory: string; active: boolean }

function mapEmployee(row: EmployeeRow): Candidate {
  return { id: row.id, name: row.name, employeeNo: row.employee_no, jobCategory: row.job_category || '员工', active: row.account_status === 'active' };
}

export function isBuiltinApprovalType(value: string): value is ApprovalApproverType {
  return (APPROVAL_APPROVER_TYPES as readonly string[]).includes(value);
}

/** 自定义审批编号：c 加 8 位小写字母或数字，与内置五类分开。 */
export function isCustomApprovalType(value: string): boolean {
  return /^c[a-z0-9]{8}$/.test(value);
}

export function parseApproverType(value: string): string {
  if (isBuiltinApprovalType(value) || isCustomApprovalType(value)) return value;
  throw badRequest('审批类型不存在');
}

async function getCandidate(id: string): Promise<Candidate | null> {
  const row = await queryOne<EmployeeRow>(`SELECT e.id, e.name, e.employee_no, e.position AS job_category, a.status AS account_status
    FROM employees e LEFT JOIN employee_accounts a ON a.employee_id = e.id WHERE e.id = ?`, [id]);
  return row ? mapEmployee(row) : null;
}

async function listCandidates(): Promise<Candidate[]> {
  const candidates = await queryRows<EmployeeRow>(`SELECT e.id, e.name, e.employee_no, e.position AS job_category, a.status AS account_status
    FROM employees e JOIN employee_accounts a ON a.employee_id = e.id
    WHERE a.status = 'active' ORDER BY e.pinyin, e.id`);
  return candidates.map(mapEmployee);
}

export async function getCustomWorkflowApproverCandidates() {
  return { candidates: await listCandidates() };
}

/** 只读取路径上的启用账号，判定与全量候选相同：账号启用即视为可选。 */
export async function getActiveApproverCandidates(ids: string[]): Promise<Candidate[]> {
  const unique = [...new Set(ids.filter((id) => id))];
  if (!unique.length) return [];
  const rows = await queryRows<EmployeeRow>(
    `SELECT e.id, e.name, e.employee_no, e.position AS job_category, a.status AS account_status
     FROM employees e JOIN employee_accounts a ON a.employee_id = e.id
     WHERE a.status = 'active' AND e.id IN (${unique.map(() => '?').join(',')})`,
    unique,
  );
  return rows.map(mapEmployee);
}

function requireBuiltinApproverType(type: string): ApprovalApproverType {
  if (!isBuiltinApprovalType(type)) throw badRequest('自定义审批的审批人在流程节点中配置');
  return type;
}

export async function getApprovalApproverSettings(type: string) {
  requireBuiltinApproverType(type);
  const [configured, list] = await Promise.all([
    queryOne<{ employee_id: string }>('SELECT employee_id FROM approval_approvers WHERE type = ?', [type]),
    listCandidates(),
  ]);
  return { approver: configured ? await getCandidate(configured.employee_id) : null, candidates: list };
}

export async function setApprovalApprover(type: string, employeeId: string, admin: AdminUser) {
  requireBuiltinApproverType(type);
  const candidate = await getCandidate(employeeId);
  if (!candidate?.active) throw badRequest('请选择拥有启用的小程序账号的员工');
  await transaction(async (conn) => {
    const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
    if (!employees.length) throw badRequest('审批人员工不存在');
    const [accounts] = await conn.query<RowDataPacket[]>('SELECT status FROM employee_accounts WHERE employee_id = ?', [employeeId]);
    const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1", [employeeId]);
    if (!accounts.length || accounts[0].status !== 'active' || departures.length) throw badRequest('请选择拥有启用小程序账号的在职员工');
    await conn.execute(`INSERT INTO approval_approvers (type, employee_id, updated_by, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), updated_by = VALUES(updated_by), updated_at = NOW()`, [type, employeeId, admin.id]);
  });
  const label = isBuiltinApprovalType(type) ? LABELS[type] : '自定义';
  await recordAdminLog(admin, `设置${label}审批人`, 'approval_approver', type, { employeeId, name: candidate.name });
  return candidate;
}

export async function getApprovalApprover(type: string): Promise<{ id: string; name: string; role: string }> {
  requireBuiltinApproverType(type);
  const configured = await queryOne<{ employee_id: string }>('SELECT employee_id FROM approval_approvers WHERE type = ?', [type]);
  const candidate = configured ? await getCandidate(configured.employee_id) : null;
  const label = isBuiltinApprovalType(type) ? LABELS[type] : '自定义';
  if (!candidate?.active) throw badRequest(`${label}审批人未配置或账号不可用，请联系超级管理员`);
  return { id: candidate.id, name: candidate.name, role: type === 'expense' ? '发票审批人' : candidate.jobCategory === '董事长' ? '董事长' : `${label}审批人` };
}
