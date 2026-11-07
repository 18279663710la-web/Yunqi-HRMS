import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { execute, queryRows, transaction } from '../../shared/db/pool';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';

export interface JobTitle { id: number; name: string; count: number }

// 一次性将旧职位分类统一为职务，保留旧工资明细原有回退显示值。
export async function backfillJobTitles(): Promise<void> {
  await transaction(async (conn) => {
    const [result] = await conn.execute<any>("INSERT IGNORE INTO app_meta (`k`, `v`) VALUES ('unified_job_titles_v1', '1')");
    if (!result.affectedRows) return;
    await conn.execute(`INSERT IGNORE INTO hr_payroll_legacy_job_titles (item_id, position)
      SELECT i.id, e.position FROM hr_payroll_batch_items i JOIN employees e ON e.id = i.employee_id
      WHERE i.model_snapshot IS NULL OR JSON_EXTRACT(i.model_snapshot, '$.position') IS NULL OR JSON_TYPE(JSON_EXTRACT(i.model_snapshot, '$.position')) = 'NULL'`);
    await conn.execute("INSERT IGNORE INTO job_titles (name) VALUES ('研发员'), ('业务员'), ('员工')");
    await conn.execute("UPDATE employees SET position = COALESCE(NULLIF(job_category, ''), '员工')");
    await conn.execute("DELETE FROM job_titles WHERE name NOT IN ('研发员', '业务员', '员工')");
  });
}

export async function listJobTitles(): Promise<JobTitle[]> {
  const rows = await queryRows<JobTitle>(`SELECT t.id, t.name, COUNT(e.id) AS count FROM job_titles t
    LEFT JOIN employees e ON TRIM(e.position) = t.name AND NOT EXISTS
      (SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed')
    GROUP BY t.id, t.name ORDER BY t.id`);
  return rows.map(row => ({ ...row, id: Number(row.id), count: Number(row.count) }));
}

export async function listAdminJobTitles() {
  const [titles, employees] = await Promise.all([
    listJobTitles(),
    queryRows<{ id: string; name: string; position: string; titleId: number; employeeNo: string; phone: string; joinDate: string; isLeader: number; loginName: string | null; accountStatus: string | null }>(`SELECT e.id, e.name, e.position, t.id AS titleId, e.employee_no AS employeeNo, e.phone, e.join_date AS joinDate, e.is_leader AS isLeader, a.login_name AS loginName, a.status AS accountStatus
      FROM employees e JOIN job_titles t ON t.name = TRIM(e.position) LEFT JOIN employee_accounts a ON a.employee_id = e.id
      WHERE NOT EXISTS (SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed') ORDER BY e.pinyin`),
  ]);
  return titles.map(title => ({ ...title, employees: employees.filter(employee => Number(employee.titleId) === title.id).map(employee => ({ ...employee, isLeader: !!employee.isLeader, accountStatus: employee.accountStatus || 'none' })) }));
}

export async function createJobTitle(name: string): Promise<{ id: number; name: string }> {
  try {
    const result = await execute('INSERT INTO job_titles (name) VALUES (?)', [name]);
    return { id: Number(result.insertId), name };
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw conflict('职务已存在');
    throw error;
  }
}

export async function assertJobTitle(conn: PoolConnection, name: string): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM job_titles WHERE name = ? FOR UPDATE', [name]);
  if (!rows.length) throw badRequest('请选择已有职务');
}

export async function deleteJobTitle(id: number): Promise<void> {
  await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT name FROM job_titles WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('职务不存在');
    const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE TRIM(position) = ? LIMIT 1', [rows[0].name]);
    if (employees.length) throw conflict('该职务仍被员工使用，请先调整员工职务');
    await conn.execute('DELETE FROM job_titles WHERE id = ?', [id]);
  });
}
