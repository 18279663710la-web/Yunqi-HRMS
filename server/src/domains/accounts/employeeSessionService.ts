import type { PoolConnection } from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { queryOne } from '../../shared/db/pool';
import { unauthorized } from '../../shared/utils/errors';
import { CHAIRPERSON_ID } from './chairpersonService';

export async function getEmployeeSessionVersion(employeeId: string): Promise<number> {
  const row = await queryOne<{ version: number }>('SELECT version FROM employee_session_versions WHERE employee_id = ?', [employeeId]);
  return Number(row?.version || 0);
}

/** 必须在对应账号修改的同一个事务中调用。 */
export async function revokeEmployeeSessions(conn: PoolConnection, employeeId: string): Promise<void> {
  await conn.execute('INSERT INTO employee_session_versions (employee_id, version) VALUES (?, 1) ON DUPLICATE KEY UPDATE version = version + 1', [employeeId]);
}

/** token 签名及类型须由调用方先验证。 */
export async function requireActiveEmployeeSession(employeeId: string, token: string): Promise<number> {
  if (employeeId === CHAIRPERSON_ID) return 0;
  const row = await queryOne<{ status: string; version: number | null; departed: number }>("SELECT a.status, v.version, EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = a.employee_id AND d.status = 'departed') AS departed FROM employee_accounts a LEFT JOIN employee_session_versions v ON v.employee_id = a.employee_id WHERE a.employee_id = ?", [employeeId]);
  const payload = jwt.decode(token);
  if (!row || row.status !== 'active' || row.departed || !payload || typeof payload === 'string') throw unauthorized();
  const tokenVersion = payload.sv === undefined ? 0 : payload.sv;
  const version = Number(row.version || 0);
  if (!Number.isInteger(tokenVersion) || tokenVersion !== version) throw unauthorized();
  return version;
}
