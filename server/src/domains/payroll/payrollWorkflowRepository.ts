import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { queryOne } from '../../shared/db/pool';

export async function findWorkflow(key: string, conn?: PoolConnection, lock = false): Promise<unknown> {
  if (conn) {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT value_json FROM hr_settings WHERE setting_key = ?${lock ? ' FOR UPDATE' : ''}`, [key]);
    return rows.length ? rows[0].value_json : undefined;
  }
  const row = await queryOne<{ value_json: unknown }>('SELECT value_json FROM hr_settings WHERE setting_key = ?', [key]);
  return row?.value_json;
}

export async function ensureWorkflow(conn: PoolConnection, key: string, value: unknown): Promise<void> {
  await conn.execute('INSERT IGNORE INTO hr_settings (setting_key, value_json, updated_at) VALUES (?, ?, NOW())', [key, JSON.stringify(value)]);
}

export async function updateWorkflow(conn: PoolConnection, key: string, value: unknown): Promise<void> {
  await conn.execute('UPDATE hr_settings SET value_json = ?, updated_at = NOW() WHERE setting_key = ?', [JSON.stringify(value), key]);
}
