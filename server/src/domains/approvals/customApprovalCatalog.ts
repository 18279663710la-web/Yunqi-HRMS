import crypto from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import { badRequest, conflict } from '../../shared/utils/errors';
import { discardPublishedWorkflow } from './customWorkflowPublication';
import { isBuiltinApprovalType, isCustomApprovalType } from './expenseApproverService';

export interface ApprovalTypeOption { key: string; name: string; custom: boolean; published: boolean }

const NAME = /^.{1,20}$/;

export async function listApprovalTypeOptions(): Promise<ApprovalTypeOption[]> {
  const rows = await queryRows<{ key: string; name: string; is_custom: number; published: number }>(`SELECT t.\`key\`, t.\`name\`, t.is_custom,
    EXISTS(SELECT 1 FROM custom_approval_publications p WHERE p.approval_type = t.\`key\`) AS published
    FROM approval_types t ORDER BY t.is_custom, t.sort_order, t.\`key\``);
  return rows.map(row => ({ key: row.key, name: row.name, custom: Number(row.is_custom) === 1, published: Number(row.published) === 1 }));
}

export async function createCustomApprovalType(name: string, adminId: number): Promise<ApprovalTypeOption> {
  const trimmed = name.trim();
  if (!NAME.test(trimmed)) throw badRequest('请填写不超过 20 字的审批名称');
  return transaction(async conn => {
    const [names] = await conn.query<RowDataPacket[]>('SELECT `key` FROM approval_types WHERE `name` = ? FOR UPDATE', [trimmed]);
    if (names.length) throw conflict('审批名称已存在');
    const [orders] = await conn.query<RowDataPacket[]>('SELECT COALESCE(MAX(sort_order), 0) AS sort_order FROM approval_types');
    const sortOrder = Number(orders[0]?.sort_order || 0) + 1;
    let key = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      key = customKey();
      const [existing] = await conn.query<RowDataPacket[]>('SELECT `key` FROM approval_types WHERE `key` = ?', [key]);
      if (!existing.length) break;
      key = '';
    }
    if (!key) throw conflict('审批编号生成失败，请重试');
    await conn.execute('INSERT INTO approval_types (`key`, `name`, color, description, fields_json, sort_order, is_custom) VALUES (?, ?, ?, ?, ?, ?, 1)', [key, trimmed, '#3D6EF7', '', '[]', sortOrder]);
    await conn.execute('INSERT INTO custom_approval_workflows (approval_type, version, graph_json, updated_by, updated_at) VALUES (?, 0, ?, ?, NOW())', [key, JSON.stringify({ nodes: [], edges: [] }), adminId]);
    return { key, name: trimmed, custom: true, published: false };
  });
}

export async function renameCustomApprovalType(key: string, name: string): Promise<ApprovalTypeOption> {
  if (!isCustomApprovalType(key)) throw badRequest('审批类型不存在');
  const trimmed = name.trim();
  if (!NAME.test(trimmed)) throw badRequest('请填写不超过 20 字的审批名称');
  return transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT `key`, `name` FROM approval_types WHERE `key` = ? AND is_custom = 1 FOR UPDATE', [key]);
    if (!rows.length) throw badRequest('审批类型不存在');
    const [names] = await conn.query<RowDataPacket[]>('SELECT `key` FROM approval_types WHERE `name` = ? AND `key` <> ?', [trimmed, key]);
    if (names.length) throw conflict('审批名称已存在');
    await conn.execute('UPDATE approval_types SET `name` = ? WHERE `key` = ?', [trimmed, key]);
    return { key, name: trimmed, custom: true, published: false };
  });
}

export async function deleteCustomApprovalType(key: string): Promise<void> {
  if (isBuiltinApprovalType(key) || !isCustomApprovalType(key)) throw badRequest('内置审批不能删除');
  await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT `key` FROM approval_types WHERE `key` = ? AND is_custom = 1 FOR UPDATE', [key]);
    if (!rows.length) throw badRequest('审批类型不存在');
    const [pending] = await conn.query<RowDataPacket[]>("SELECT id FROM approvals WHERE type = ? AND status = 'pending' LIMIT 1 FOR UPDATE", [key]);
    if (pending.length) throw badRequest('该审批仍有待处理申请，不能删除');
    await conn.execute('DELETE FROM custom_approval_credentials WHERE approval_type = ?', [key]);
    await conn.execute('DELETE FROM custom_approval_test_runs WHERE approval_type = ?', [key]);
    await conn.execute('DELETE FROM custom_approval_test_cases WHERE approval_type = ?', [key]);
    await conn.execute('DELETE FROM custom_approval_publications WHERE approval_type = ?', [key]);
    await conn.execute('DELETE FROM custom_approval_workflows WHERE approval_type = ?', [key]);
    await conn.execute('DELETE FROM approval_approvers WHERE type = ?', [key]);
    await conn.execute('DELETE FROM approval_types WHERE `key` = ? AND is_custom = 1', [key]);
  });
  discardPublishedWorkflow(key);
}

function customKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `c${Array.from(crypto.randomBytes(8), byte => alphabet[byte % alphabet.length]).join('')}`;
}
