import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { transaction } from '../../shared/db/pool';
import { dateKey } from '../../shared/utils/datetime';
import { badRequest, notFound } from '../../shared/utils/errors';
import { revokeEmployeeSessions } from '../../domains/accounts/employeeSessionService';

/** 显式确认离职；清单完成与正式离职分别记录。 */
export async function finalizeDeparture(caseId: string, adminId: number) {
  return transaction(async (conn) => {
    const [cases] = await conn.query<RowDataPacket[]>('SELECT employee_id FROM hr_offboarding WHERE id = ?', [caseId]);
    if (!cases.length) throw notFound('离职清单不存在');
    const employeeId = String(cases[0].employee_id);
    const [employees] = await conn.query<RowDataPacket[]>("SELECT id, DATE_FORMAT(join_date, '%Y-%m-%d') AS joinDate FROM employees WHERE id = ? FOR UPDATE", [employeeId]);
    if (!employees.length) throw notFound('员工不存在');
    const [locked] = await conn.query<RowDataPacket[]>('SELECT status, last_date FROM hr_offboarding WHERE id = ? FOR UPDATE', [caseId]);
    if (!locked.length || locked[0].status !== 'completed') throw badRequest('请先完成离职交接清单');
    const lastDate = locked[0].last_date instanceof Date ? dateKey(locked[0].last_date) : String(locked[0].last_date).slice(0, 10);
    if (lastDate < String(employees[0].joinDate)) throw badRequest('最后工作日不能早于入职日期');
    if (lastDate > dateKey()) throw badRequest('最后工作日尚未到，不能确认离职');
    const [existing] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1 FOR UPDATE", [employeeId]);
    if (existing.length) throw badRequest('该员工已经确认离职');
    const [usedCase] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_employee_departures WHERE offboarding_id = ? FOR UPDATE', [caseId]);
    if (usedCase.length) throw badRequest('该清单已经办理过离职，如需再次办理请新建清单');
    const [configured] = await conn.query<RowDataPacket[]>('SELECT type FROM approval_approvers WHERE employee_id = ? LIMIT 1 FOR UPDATE', [employeeId]);
    if (configured.length) throw badRequest('该员工仍是指定审批人，请先更换审批人');
    const [pending] = await conn.query<RowDataPacket[]>("SELECT a.id FROM approvals a LEFT JOIN approval_timeline t ON t.approval_id = a.id AND t.approver_id = ? AND t.state IN ('current', 'wait') WHERE a.status = 'pending' AND (a.applicant_id = ? OR t.id IS NOT NULL) LIMIT 1 FOR UPDATE", [employeeId, employeeId]);
    if (pending.length) throw badRequest('该员工仍有待处理的申请或审批，请先处理');
    await conn.execute("UPDATE employee_accounts SET status = 'disabled', updated_at = NOW() WHERE employee_id = ?", [employeeId]);
    await revokeEmployeeSessions(conn, employeeId);
    const [result] = await conn.execute<ResultSetHeader>("INSERT INTO hr_employee_departures (offboarding_id, employee_id, last_date, status, created_by, created_at) VALUES (?, ?, ?, 'departed', ?, NOW())", [caseId, employeeId, lastDate, adminId]);
    return { id: result.insertId, employeeId };
  });
}

/** 撤销离职不会自动重新启用账号，需管理员单独处理。 */
export async function cancelDeparture(caseId: string, adminId: number) {
  await transaction(async (conn) => {
    const [cases] = await conn.query<RowDataPacket[]>('SELECT employee_id FROM hr_offboarding WHERE id = ?', [caseId]);
    if (!cases.length) throw notFound('离职清单不存在');
    const employeeId = String(cases[0].employee_id);
    const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
    if (!employees.length) throw notFound('员工不存在');
    const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE offboarding_id = ? AND status = 'departed' FOR UPDATE", [caseId]);
    if (!departures.length) throw badRequest('该离职记录不存在或已撤销');
    await conn.execute("UPDATE hr_employee_departures SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?", [adminId, departures[0].id]);
  });
}
