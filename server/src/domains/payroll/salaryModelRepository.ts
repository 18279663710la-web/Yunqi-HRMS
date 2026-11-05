import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

export async function ensureAndLockModel(conn: PoolConnection, key: string, fallback: unknown): Promise<unknown> {
  await conn.execute('INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)', [key, JSON.stringify(fallback)]);
  const [rows] = await conn.query<RowDataPacket[]>('SELECT value_json FROM hr_settings WHERE setting_key = ? FOR UPDATE', [key]);
  return rows[0].value_json;
}

export async function lockSalaryRecords(conn: PoolConnection): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT employee_id, data_json, updated_at FROM hr_employee_records WHERE section = 'salary' ORDER BY employee_id FOR UPDATE");
  return rows;
}

export async function hasSalaryHistory(conn: PoolConnection, employeeId: string): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_history WHERE employee_id = ? AND section = 'salary' LIMIT 1", [employeeId]);
  return rows.length > 0;
}

export async function saveSalaryHistory(conn: PoolConnection, employeeId: string, data: unknown, createdAt?: string): Promise<void> {
  if (createdAt !== undefined) await conn.execute("INSERT INTO hr_employee_history (employee_id, section, data_json, created_at) VALUES (?, 'salary', ?, ?)", [employeeId, JSON.stringify(data), createdAt]);
  else await conn.execute("INSERT INTO hr_employee_history (employee_id, section, data_json, created_at) VALUES (?, 'salary', ?, NOW())", [employeeId, JSON.stringify(data)]);
}

export async function updateSalaryRecord(conn: PoolConnection, employeeId: string, data: unknown): Promise<void> {
  await conn.execute("UPDATE hr_employee_records SET data_json = ?, updated_at = NOW() WHERE employee_id = ? AND section = 'salary'", [JSON.stringify(data), employeeId]);
}

export async function updateModel(conn: PoolConnection, key: string, model: unknown): Promise<void> {
  await conn.execute('UPDATE hr_settings SET value_json = ?, updated_at = NOW() WHERE setting_key = ?', [JSON.stringify(model), key]);
}
