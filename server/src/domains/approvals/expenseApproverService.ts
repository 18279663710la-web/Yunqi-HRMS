import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { RowDataPacket } from 'mysql2';
import type { AdminUser } from '../../shared/types/admin';
import { badRequest } from '../../shared/utils/errors';
import { recordAdminLog } from '../audit/adminLogService';
import { CHAIRPERSON_ID, getChairpersonAccount } from '../accounts/chairpersonService';

export const APPROVAL_APPROVER_TYPES = ['leave', 'expense', 'overtime', 'travel', 'purchase'] as const;
export type ApprovalApproverType = typeof APPROVAL_APPROVER_TYPES[number];
const LABELS: Record<ApprovalApproverType, string> = { leave: '请假', expense: '报销', overtime: '加班', travel: '出差', purchase: '采购' };

export function chairpersonCanApprove(type: string): boolean {
  return type === 'leave' || type === 'overtime' || type === 'travel' || type === 'purchase';
}

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

function mapChairperson(active: boolean): Candidate {
  return { id: CHAIRPERSON_ID, name: '董事长', employeeNo: '', jobCategory: '董事长', active };
}

export function parseApproverType(value: string): ApprovalApproverType {
  if (!(APPROVAL_APPROVER_TYPES as readonly string[]).includes(value)) throw badRequest('审批类型不存在');
  return value as ApprovalApproverType;
}

async function getCandidate(id: string, type: ApprovalApproverType): Promise<Candidate | null> {
  if (id === CHAIRPERSON_ID) {
    if (!chairpersonCanApprove(type)) return null;
    const account = await getChairpersonAccount();
    return account ? mapChairperson(account.status === 'active') : null;
  }
  const row = await queryOne<EmployeeRow>(`SELECT e.id, e.name, e.employee_no, e.job_category, a.status AS account_status
    FROM employees e LEFT JOIN employee_accounts a ON a.employee_id = e.id WHERE e.id = ?`, [id]);
  return row ? mapEmployee(row) : null;
}

export async function getApprovalApproverSettings(type: ApprovalApproverType) {
  const [configured, candidates, chairperson] = await Promise.all([
    queryOne<{ employee_id: string }>('SELECT employee_id FROM approval_approvers WHERE type = ?', [type]),
    queryRows<EmployeeRow>(`SELECT e.id, e.name, e.employee_no, e.job_category, a.status AS account_status
      FROM employees e JOIN employee_accounts a ON a.employee_id = e.id
      WHERE a.status = 'active' ORDER BY e.pinyin, e.id`),
    chairpersonCanApprove(type) ? getChairpersonAccount() : Promise.resolve(null),
  ]);
  const list = candidates.map(mapEmployee);
  if (chairperson?.status === 'active') list.unshift(mapChairperson(true));
  return { approver: configured ? await getCandidate(configured.employee_id, type) : null, candidates: list };
}

export async function setApprovalApprover(type: ApprovalApproverType, employeeId: string, admin: AdminUser) {
  const candidate = await getCandidate(employeeId, type);
  if (!candidate?.active) throw badRequest(chairpersonCanApprove(type) ? '请选择已启用小程序账号的员工或董事长' : '请选择拥有启用的小程序账号的员工');
  await transaction(async (conn) => {
    if (employeeId !== CHAIRPERSON_ID) {
      const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
      if (!employees.length) throw badRequest('审批人员工不存在');
      const [accounts] = await conn.query<RowDataPacket[]>('SELECT status FROM employee_accounts WHERE employee_id = ?', [employeeId]);
      const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1", [employeeId]);
      if (!accounts.length || accounts[0].status !== 'active' || departures.length) throw badRequest('请选择拥有启用小程序账号的在职员工');
    }
    await conn.execute(`INSERT INTO approval_approvers (type, employee_id, updated_by, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), updated_by = VALUES(updated_by), updated_at = NOW()`, [type, employeeId, admin.id]);
  });
  await recordAdminLog(admin, `设置${LABELS[type]}审批人`, 'approval_approver', type, { employeeId, name: candidate.name });
  return candidate;
}

export async function getApprovalApprover(type: ApprovalApproverType): Promise<{ id: string; name: string; role: string }> {
  const configured = await queryOne<{ employee_id: string }>('SELECT employee_id FROM approval_approvers WHERE type = ?', [type]);
  const candidate = configured ? await getCandidate(configured.employee_id, type) : null;
  if (!candidate?.active) throw badRequest(`${LABELS[type]}审批人未配置或账号不可用，请联系超级管理员`);
  return { id: candidate.id, name: candidate.name, role: type === 'expense' ? '发票审批人' : candidate.id === CHAIRPERSON_ID ? '董事长' : `${LABELS[type]}审批人` };
}

// 保留原报销接口，兼容已发布的小程序与管理后台。
export const getExpenseApproverSettings = () => getApprovalApproverSettings('expense');
export const setExpenseApprover = (employeeId: string, admin: AdminUser) => setApprovalApprover('expense', employeeId, admin);
export const getExpenseApprover = () => getApprovalApprover('expense');
