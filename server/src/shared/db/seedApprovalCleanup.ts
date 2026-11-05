import { queryRows, transaction } from './pool';
import { approvals } from './seedData';

const conditions = approvals.map(() => '(id = ? AND type = ? AND title = ? AND applicant_id = ? AND created_at = ?)').join(' OR ');
const params = approvals.flatMap((item) => [item.id, item.type, item.title, item.applicantId, item.createdAt]);
const selectSql = `SELECT id FROM approvals WHERE ${conditions} ORDER BY id`;

/** 仅匹配内置样本的固定身份字段，避免删除其他申请。 */
export async function findSeedApprovals(): Promise<string[]> {
  return (await queryRows<{ id: string }>(selectSql, params)).map((row) => row.id);
}

export async function removeSeedApprovals(): Promise<number> {
  return transaction(async (conn) => {
    const [result] = await conn.query(`${selectSql} FOR UPDATE`, params);
    const ids = (result as Array<{ id: string }>).map((row) => row.id);
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    await conn.query(`DELETE FROM expense_ai_jobs WHERE approval_id IN (${placeholders})`, ids);
    await conn.query(`DELETE FROM expense_attachments WHERE approval_id IN (${placeholders})`, ids);
    await conn.query(`DELETE FROM approval_timeline WHERE approval_id IN (${placeholders})`, ids);
    await conn.query(`DELETE FROM invoices WHERE approval_id IN (${placeholders})`, ids);
    await conn.query(`DELETE FROM approvals WHERE id IN (${placeholders})`, ids);
    return ids.length;
  });
}
