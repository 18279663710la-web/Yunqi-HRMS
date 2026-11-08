import { randomBytes } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { queryRows, transaction } from '../../shared/db/pool';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';

const ROOT = 'D00';

// 旧部门名称留作人事异动历史展示，不作为可选组织。
export async function migrateOrganizations(): Promise<void> {
  await transaction(async conn => {
    const [marker] = await conn.execute<any>("INSERT IGNORE INTO app_meta (`k`, `v`) VALUES ('flat_organizations_v1', '1')");
    if (!marker.affectedRows) return;
    await conn.execute('INSERT IGNORE INTO legacy_department_names (id, name) SELECT id, name FROM departments');
    await conn.execute("INSERT INTO departments (id, parent_id, name, leader_id, sort_order) VALUES ('D00', NULL, '未分配', NULL, 0) ON DUPLICATE KEY UPDATE parent_id = NULL, name = '未分配', leader_id = NULL");
    await conn.execute("UPDATE employees SET dept_id = 'D00'");
    await conn.execute("DELETE FROM departments WHERE id <> 'D00'");
  });
}

export async function listOrganizations() {
  const rows = await queryRows<{ id: string; name: string; count: number }>(`SELECT d.id, d.name, COUNT(e.id) AS count FROM departments d
    LEFT JOIN employees e ON e.dept_id = d.id AND NOT EXISTS (SELECT 1 FROM hr_employee_departures x WHERE x.employee_id = e.id AND x.status = 'departed')
    WHERE d.id <> 'D00' AND d.parent_id = 'D00' GROUP BY d.id, d.name ORDER BY d.name, d.id`);
  return rows.map(row => ({ ...row, count: Number(row.count) }));
}

export async function assertOrganization(conn: PoolConnection, id: string): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? FOR UPDATE', [id]);
  if (!rows.length) throw badRequest('组织不存在');
}

async function lockRoot(conn: PoolConnection): Promise<void> { await assertOrganization(conn, ROOT); }

export async function createOrganization(name: string) {
  if (name === '未分配') throw conflict('该组织名称不可使用');
  return transaction(async conn => {
    await lockRoot(conn);
    const [matches] = await conn.query<RowDataPacket[]>('SELECT id FROM departments WHERE name = ? AND id <> ? LIMIT 1', [name, ROOT]);
    if (matches.length) throw conflict('组织已存在');
    const id = `O${randomBytes(4).toString('hex')}`;
    await conn.execute('INSERT INTO departments (id, parent_id, name, leader_id, sort_order) VALUES (?, ?, ?, NULL, 0)', [id, ROOT, name]);
    return { id, name };
  });
}

export async function renameOrganization(id: string, name: string) {
  if (name === '未分配') throw conflict('该组织名称不可使用');
  return transaction(async conn => {
    await lockRoot(conn);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? AND parent_id = ? FOR UPDATE', [id, ROOT]);
    if (!rows.length) throw notFound('组织不存在');
    const [matches] = await conn.query<RowDataPacket[]>('SELECT id FROM departments WHERE name = ? AND id <> ? AND id <> ? LIMIT 1', [name, id, ROOT]);
    if (matches.length) throw conflict('组织已存在');
    await conn.execute('UPDATE departments SET name = ? WHERE id = ?', [name, id]);
    return { id, name };
  });
}

export async function deleteOrganization(id: string): Promise<void> {
  await transaction(async conn => {
    await lockRoot(conn);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? AND parent_id = ? FOR UPDATE', [id, ROOT]);
    if (!rows.length) throw notFound('组织不存在');
    const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE dept_id = ? LIMIT 1', [id]);
    if (employees.length) throw conflict('该组织仍被员工使用，请先调整员工组织');
    const [history] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_transitions WHERE JSON_UNQUOTE(JSON_EXTRACT(before_json, '$.deptId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(after_json, '$.deptId')) = ? LIMIT 1", [id, id]);
    if (history.length) await conn.execute('INSERT INTO legacy_department_names (id, name) SELECT id, name FROM departments WHERE id = ? ON DUPLICATE KEY UPDATE name = VALUES(name)', [id]);
    await conn.execute('DELETE FROM departments WHERE id = ?', [id]);
  });
}
