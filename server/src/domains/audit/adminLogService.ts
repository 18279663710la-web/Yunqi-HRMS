import { execute, queryRows } from '../../shared/db/pool';
import type { AdminOperationLog, AdminUser } from '../../shared/types/admin';
import { toMinuteText } from '../../shared/utils/datetime';

interface LogRow {
  id: number;
  admin_id: number;
  admin_name: string;
  action: string;
  target_type: string;
  target_id: string;
  detail_json: string | Record<string, unknown> | null;
  created_at: string;
}

function parseDetail(value: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return value;
}

/** 审计日志失败不影响主操作 */
export async function recordAdminLog(
  admin: AdminUser,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await execute(
      `INSERT INTO admin_operation_logs
        (admin_id, admin_name, action, target_type, target_id, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [admin.id, admin.name, action, targetType, targetId, JSON.stringify(detail ?? {})]
    );
  } catch (err) {
    console.error('[admin log] 写入失败', err);
  }
}

export async function listAdminLogs(limit = 20): Promise<AdminOperationLog[]> {
  const rows = await queryRows<LogRow>(
    'SELECT * FROM admin_operation_logs ORDER BY id DESC LIMIT ?',
    [Math.min(Math.max(Number(limit) || 20, 1), 200)]
  );
  return rows.map((row) => ({
    id: row.id,
    adminId: row.admin_id,
    adminName: row.admin_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: parseDetail(row.detail_json),
    createdAt: toMinuteText(row.created_at),
  }));
}
