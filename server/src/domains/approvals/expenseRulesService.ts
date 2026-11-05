import { execute, queryOne } from '../../shared/db/pool';
import type { AdminUser } from '../../shared/types/admin';
import { toMinuteText } from '../../shared/utils/datetime';
import { recordAdminLog } from '../audit/adminLogService';

export async function getExpenseRules(): Promise<{ content: string; updatedAt: string | null }> {
  const row = await queryOne<{ content: string; updated_at: string }>(
    "SELECT content, updated_at FROM approval_rules WHERE type = 'expense'"
  );
  return row ? { content: row.content, updatedAt: toMinuteText(row.updated_at) } : { content: '', updatedAt: null };
}

export async function saveExpenseRules(content: string, admin: AdminUser): Promise<{ content: string; updatedAt: string | null }> {
  await execute(`INSERT INTO approval_rules (type, content, updated_by, updated_at) VALUES ('expense', ?, ?, NOW())
    ON DUPLICATE KEY UPDATE content = VALUES(content), updated_by = VALUES(updated_by), updated_at = NOW()`, [content, admin.id]);
  await recordAdminLog(admin, '修改报销审批规则', 'approval_rules', 'expense', {});
  return getExpenseRules();
}
