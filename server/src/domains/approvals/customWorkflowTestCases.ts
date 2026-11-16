import { z } from 'zod';
import type { RowDataPacket } from 'mysql2';
import { queryOne, transaction } from '../../shared/db/pool';
import { conflict, badRequest } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';

const caseSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100), values: z.record(z.string().min(1).max(40), z.string().max(2000)) }).strict();
export const workflowTestCasesSchema = z.object({ version: z.number().int().min(0), cases: z.array(caseSchema).max(50) }).strict();
export type WorkflowTestCasesDocument = z.infer<typeof workflowTestCasesSchema>;

export async function readWorkflowTestCases(type: string): Promise<WorkflowTestCasesDocument> {
  const row = await queryOne<{ version: number; cases_json: string | unknown[] }>('SELECT version, cases_json FROM custom_approval_test_cases WHERE approval_type = ?', [type]);
  if (!row) return { version: 0, cases: [] };
  const cases = typeof row.cases_json === 'string' ? JSON.parse(row.cases_json) : row.cases_json;
  const result = workflowTestCasesSchema.safeParse({ version: Number(row.version), cases });
  if (!result.success) throw new Error('测试用例数据格式无效');
  return result.data;
}

export async function saveWorkflowTestCases(type: string, document: WorkflowTestCasesDocument, adminId: number): Promise<WorkflowTestCasesDocument> {
  if (new Set(document.cases.map(item => item.id)).size !== document.cases.length) throw badRequest('测试用例编号重复');
  return transaction(async conn => {
    await conn.execute('INSERT IGNORE INTO custom_approval_test_cases (approval_type, version, cases_json, updated_by, updated_at) VALUES (?, 0, ?, ?, NOW())', [type, JSON.stringify([]), adminId]);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT version FROM custom_approval_test_cases WHERE approval_type = ? FOR UPDATE', [type]);
    if (Number(rows[0].version) !== document.version) throw conflict('测试用例已被修改，请刷新后重试');
    await conn.execute('UPDATE custom_approval_test_cases SET version = ?, cases_json = ?, updated_by = ?, updated_at = NOW() WHERE approval_type = ?', [document.version + 1, JSON.stringify(document.cases), adminId, type]);
    return { version: document.version + 1, cases: document.cases };
  });
}
