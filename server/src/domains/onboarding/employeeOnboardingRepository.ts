import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { queryOne } from '../../shared/db/pool';

export function findPendingOnboarding(employeeId: string) {
  return queryOne<{ id: number; template: unknown; expectedDate: string; answers: unknown }>('SELECT id, template_json AS template, expected_date AS expectedDate, answers_json AS answers FROM hr_self_onboarding WHERE employee_id = ? AND submitted_at IS NULL', [employeeId]);
}

export async function lockPendingOnboarding(conn: PoolConnection, employeeId: string) {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT id, template_json FROM hr_self_onboarding WHERE employee_id = ? AND submitted_at IS NULL AND archived_at IS NULL FOR UPDATE', [employeeId]);
  return rows[0];
}

export async function saveOnboardingSubmission(conn: PoolConnection, id: number, value: unknown): Promise<void> {
  await conn.execute('UPDATE hr_self_onboarding SET answers_json = ?, submitted_at = NOW() WHERE id = ?', [JSON.stringify(value), id]);
}
