import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { queryRows, transaction } from '../../shared/db/pool';
import { dateKey } from '../../shared/utils/datetime';
import { badRequest, notFound } from '../../shared/utils/errors';
import { revokeEmployeeSessions } from '../../domains/accounts/employeeSessionService';

const LOCKED_PASSWORD_PREFIX = 'locked$';

export type DepartureStatus = 'applied' | 'departed' | 'cancelled';

export interface DepartureFileInput {
  fileName: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

async function assertDepartureClearance(conn: PoolConnection, employeeId: string): Promise<void> {
  const [configured] = await conn.query<RowDataPacket[]>('SELECT type FROM approval_approvers WHERE employee_id = ? LIMIT 1 FOR UPDATE', [employeeId]);
  if (configured.length) throw badRequest('该员工仍是指定审批人，请先更换审批人');
  const [published] = await conn.query<RowDataPacket[]>('SELECT graph_json FROM custom_approval_publications ORDER BY approval_type FOR UPDATE');
  for (const row of published) {
    const graph = typeof row.graph_json === 'string' ? JSON.parse(row.graph_json) : row.graph_json;
    if (!graph || !Array.isArray(graph.nodes)) throw new Error('已发布审批流程格式无效');
    if (graph.nodes.some((node: { kind?: string; config?: { approverIds?: string[] } }) => node.kind === 'approver' && node.config?.approverIds?.includes(employeeId))) {
      throw badRequest('该员工仍是已发布流程的审批人，请先调整并发布流程');
    }
  }
  const [pending] = await conn.query<RowDataPacket[]>(
    "SELECT a.id FROM approvals a LEFT JOIN approval_timeline t ON t.approval_id = a.id AND t.approver_id = ? AND t.state IN ('current', 'wait') WHERE a.status = 'pending' AND (a.applicant_id = ? OR t.id IS NOT NULL) LIMIT 1 FOR UPDATE",
    [employeeId, employeeId]
  );
  if (pending.length) throw badRequest('该员工仍有待处理的申请或审批，请先处理');
}

async function lockEmployeeAccount(conn: PoolConnection, employeeId: string): Promise<void> {
  const [accounts] = await conn.query<RowDataPacket[]>('SELECT password_hash FROM employee_accounts WHERE employee_id = ? FOR UPDATE', [employeeId]);
  if (accounts.length) {
    const hash = String(accounts[0].password_hash || '');
    const nextHash = hash.startsWith(LOCKED_PASSWORD_PREFIX) ? hash : `${LOCKED_PASSWORD_PREFIX}${hash}`;
    await conn.execute("UPDATE employee_accounts SET password_hash = ?, status = 'disabled', updated_at = NOW() WHERE employee_id = ?", [nextHash, employeeId]);
  }
  await revokeEmployeeSessions(conn, employeeId);
}

async function activateDueDepartureRows(conn: PoolConnection, employeeId?: string): Promise<void> {
  const today = dateKey();
  const params: unknown[] = [today];
  let sql = "SELECT id, employee_id FROM hr_employee_departures WHERE status = 'applied' AND last_date <= ?";
  if (employeeId) {
    sql += ' AND employee_id = ?';
    params.push(employeeId);
  }
  sql += ' FOR UPDATE';
  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  for (const row of rows) {
    const id = Number(row.id);
    const targetEmployeeId = String(row.employee_id);
    await lockEmployeeAccount(conn, targetEmployeeId);
    await conn.execute("UPDATE hr_employee_departures SET status = 'departed' WHERE id = ? AND status = 'applied'", [id]);
  }
}

/** 去掉离职锁定前缀并启用账号。没有账号时不处理。 */
export async function unlockEmployeeAccount(conn: PoolConnection, employeeId: string): Promise<void> {
  const [accounts] = await conn.query<RowDataPacket[]>('SELECT password_hash FROM employee_accounts WHERE employee_id = ? FOR UPDATE', [employeeId]);
  if (!accounts.length) return;
  let hash = String(accounts[0].password_hash || '');
  if (hash.startsWith(LOCKED_PASSWORD_PREFIX)) hash = hash.slice(LOCKED_PASSWORD_PREFIX.length);
  await conn.execute("UPDATE employee_accounts SET password_hash = ?, status = 'active', updated_at = NOW() WHERE employee_id = ?", [hash, employeeId]);
}

async function completeDueReinstatementRows(conn: PoolConnection, employeeId?: string): Promise<void> {
  const today = dateKey();
  const params: unknown[] = [today];
  let sql = "SELECT id, employee_id FROM hr_employee_departures WHERE status = 'departed' AND reinstatement_date IS NOT NULL AND reinstatement_date <= ?";
  if (employeeId) {
    sql += ' AND employee_id = ?';
    params.push(employeeId);
  }
  sql += ' FOR UPDATE';
  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  for (const row of rows) {
    await unlockEmployeeAccount(conn, String(row.employee_id));
    await conn.execute("UPDATE hr_employee_departures SET status = 'cancelled', cancelled_at = NOW() WHERE id = ? AND status = 'departed'", [row.id]);
  }
}

/** 将到期的「已申请」转为「已离职」并锁定；到期的「待复职」恢复账号。 */
export async function activateDueDepartures(employeeId?: string): Promise<void> {
  await transaction(async (conn) => {
    await activateDueDepartureRows(conn, employeeId);
    await completeDueReinstatementRows(conn, employeeId);
  });
}

/** 管理员登记离职：未到离职日为已申请，已到则为已离职并锁定。 */
export async function registerDeparture(input: {
  employeeId: string;
  lastDate: string;
  note?: string;
  files?: DepartureFileInput[];
  adminId: number;
}): Promise<{ id: number; employeeId: string; status: 'applied' | 'departed' }> {
  const files = input.files || [];
  if (files.length > 5) throw badRequest('最多上传 5 个附件');
  for (const file of files) {
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw badRequest('单个附件不能超过 10MB');
    if (!file.fileName.trim()) throw badRequest('附件名称无效');
  }
  return transaction(async (conn) => {
    const [employees] = await conn.query<RowDataPacket[]>("SELECT id, DATE_FORMAT(join_date, '%Y-%m-%d') AS joinDate FROM employees WHERE id = ? FOR UPDATE", [input.employeeId]);
    if (!employees.length) throw notFound('员工不存在');
    if (input.lastDate < String(employees[0].joinDate)) throw badRequest('离职日期不能早于入职日期');
    await activateDueDepartureRows(conn, input.employeeId);
    const [existing] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM hr_employee_departures WHERE employee_id = ? AND status IN ('applied', 'departed') LIMIT 1 FOR UPDATE",
      [input.employeeId]
    );
    if (existing.length) throw badRequest(existing[0].status === 'applied' ? '该员工已有离职申请' : '该员工已经离职');
    await assertDepartureClearance(conn, input.employeeId);
    const status: 'applied' | 'departed' = input.lastDate <= dateKey() ? 'departed' : 'applied';
    const [result] = await conn.execute<ResultSetHeader>(
      'INSERT INTO hr_employee_departures (offboarding_id, employee_id, last_date, note, status, created_by, created_at) VALUES (NULL, ?, ?, ?, ?, ?, NOW())',
      [input.employeeId, input.lastDate, input.note || '', status, input.adminId]
    );
    const departureId = result.insertId;
    for (const file of files) {
      await conn.execute(
        'INSERT INTO hr_departure_files (departure_id, employee_id, file_name, mime_type, file_size, file_data, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [departureId, input.employeeId, file.fileName, file.mimeType, file.size, file.data, input.adminId]
      );
    }
    if (status === 'departed') await lockEmployeeAccount(conn, input.employeeId);
    return { id: departureId, employeeId: input.employeeId, status };
  });
}

export async function listDepartures() {
  await activateDueDepartures();
  return queryRows<{
    id: number;
    employeeId: string;
    name: string;
    employeeNo: string;
    position: string;
    lastDate: string;
    note: string;
    status: 'applied' | 'departed' | 'pending_reinstatement';
    reinstatementDate: string | null;
    createdAt: unknown;
    fileCount: number;
  }>(
    `SELECT d.id, d.employee_id AS employeeId, e.name, e.employee_no AS employeeNo, e.position,
            DATE_FORMAT(d.last_date, '%Y-%m-%d') AS lastDate, DATE_FORMAT(d.reinstatement_date, '%Y-%m-%d') AS reinstatementDate,
            d.note, d.status, d.created_at AS createdAt,
            (SELECT COUNT(*) FROM hr_departure_files f WHERE f.departure_id = d.id) AS fileCount
     FROM hr_employee_departures d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.status IN ('applied', 'departed')
     ORDER BY d.id DESC
     LIMIT 200`
  ).then((rows) => rows.map((row) => ({
    ...row,
    fileCount: Number(row.fileCount),
    status: row.status === 'departed' && row.reinstatementDate && row.reinstatementDate > dateKey()
      ? 'pending_reinstatement' as const
      : row.status,
  })));
}

export async function cancelDepartureRecord(departureId: number, adminId: number): Promise<void> {
  await transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT employee_id, status FROM hr_employee_departures WHERE id = ? FOR UPDATE", [departureId]);
    if (!rows.length) throw notFound('离职记录不存在');
    if (rows[0].status !== 'applied') throw badRequest(rows[0].status === 'departed' ? '已离职员工请办理复职' : '该离职记录不可撤销');
    await conn.execute("UPDATE hr_employee_departures SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?", [adminId, departureId]);
  });
}

/** 已离职员工安排复职。日期未到时保持锁定并记为待复职；日期已到则立即恢复账号。 */
export async function scheduleReinstatement(
  departureId: number,
  reinstatementDate: string,
  adminId: number
): Promise<{ employeeId: string; status: 'pending_reinstatement' | 'reinstated' }> {
  return transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT employee_id, status, DATE_FORMAT(last_date, '%Y-%m-%d') AS lastDate, DATE_FORMAT(reinstatement_date, '%Y-%m-%d') AS reinstatementDate FROM hr_employee_departures WHERE id = ? FOR UPDATE",
      [departureId]
    );
    if (!rows.length) throw notFound('离职记录不存在');
    if (rows[0].status !== 'departed') throw badRequest('只有已离职员工可以复职');
    if (rows[0].reinstatementDate) throw badRequest('该员工已在待复职');
    if (reinstatementDate < String(rows[0].lastDate)) throw badRequest('复职日期不能早于离职日期');
    const employeeId = String(rows[0].employee_id);
    if (reinstatementDate <= dateKey()) {
      await conn.execute(
        "UPDATE hr_employee_departures SET reinstatement_date = ?, status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?",
        [reinstatementDate, adminId, departureId]
      );
      await unlockEmployeeAccount(conn, employeeId);
      return { employeeId, status: 'reinstated' };
    }
    await conn.execute('UPDATE hr_employee_departures SET reinstatement_date = ? WHERE id = ?', [reinstatementDate, departureId]);
    return { employeeId, status: 'pending_reinstatement' };
  });
}

export async function listDepartureFiles(departureId: number) {
  return queryRows<{ id: number; name: string; size: number; mimeType: string; createdAt: unknown }>(
    'SELECT id, file_name AS name, file_size AS size, mime_type AS mimeType, created_at AS createdAt FROM hr_departure_files WHERE departure_id = ? ORDER BY id',
    [departureId]
  );
}

export async function getDepartureFile(departureId: number, fileId: number) {
  const row = await queryRows<{ file_name: string; mime_type: string; file_data: Buffer }>(
    'SELECT file_name, mime_type, file_data FROM hr_departure_files WHERE departure_id = ? AND id = ? LIMIT 1',
    [departureId, fileId]
  );
  if (!row.length) throw notFound('附件不存在');
  return row[0];
}


