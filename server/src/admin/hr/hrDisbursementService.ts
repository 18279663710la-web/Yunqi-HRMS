import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { transaction } from '../../shared/db/pool';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { calculateDisbursementNet, type DisbursementCategory } from '../../domains/payroll/payrollDisbursementCalculation';
import { readSalaryModel } from '../../domains/payroll/salaryModelService';

export interface DisbursementFieldInput { name: string; category: DisbursementCategory; required: boolean; displaySetting: 'none' | 'display' | 'output' }
async function lockReviewedBatch(conn: PoolConnection, batchId: number) {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [batchId]);
  if (!rows.length) throw notFound('工资批次不存在');
  if (rows[0].status !== 'reviewed') throw badRequest('只能处理已复核的工资批次');
}

async function readState(conn: PoolConnection, batchId: number) {
  const [fields] = await conn.query<RowDataPacket[]>('SELECT id, name, category, required, display_setting AS displaySetting FROM hr_payroll_disbursement_fields WHERE batch_id = ? ORDER BY id', [batchId]);
  const [items] = await conn.query<RowDataPacket[]>('SELECT id, gross FROM hr_payroll_batch_items WHERE batch_id = ? ORDER BY id', [batchId]);
  const [values] = await conn.query<RowDataPacket[]>('SELECT v.item_id AS itemId, v.field_id AS fieldId, v.value, v.revision FROM hr_payroll_disbursement_values v JOIN hr_payroll_disbursement_fields f ON f.id = v.field_id JOIN hr_payroll_batch_items i ON i.id = v.item_id AND i.batch_id = f.batch_id WHERE f.batch_id = ?', [batchId]);
  const valuesByKey = new Map(values.map(value => [`${value.itemId}:${value.fieldId}`, value]));
  return {
    fields: fields.map(field => ({ id: Number(field.id), name: field.name as string, category: field.category as DisbursementCategory, required: !!field.required, displaySetting: field.displaySetting as DisbursementFieldInput['displaySetting'] })),
    rows: items.map(item => {
      const itemValues = fields.map(field => {
        const stored = valuesByKey.get(`${item.id}:${field.id}`);
        return { fieldId: Number(field.id), value: Number(stored?.value ?? 0), revision: Number(stored?.revision ?? 0) };
      });
      return { itemId: Number(item.id), net: calculateDisbursementNet(Number(item.gross), fields.map((field, index) => ({ category: field.category as DisbursementCategory, value: itemValues[index].value }))), values: itemValues };
    }),
  };
}

export async function getDisbursement(batchId: number) {
  return transaction(async conn => { await lockReviewedBatch(conn, batchId); return readState(conn, batchId); });
}

export async function addDisbursementField(batchId: number, input: DisbursementFieldInput) {
  return transaction(async conn => {
    await lockReviewedBatch(conn, batchId);
    const [existing] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_payroll_disbursement_fields WHERE batch_id = ? AND name = ?', [batchId, input.name]);
    if (existing.length) throw conflict('补充项名称不能重复');
    const [count] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM hr_payroll_disbursement_fields WHERE batch_id = ?', [batchId]);
    if (Number(count[0].total) >= 51) throw badRequest('最多添加 51 个补充项');
    const model = await readSalaryModel(conn);
    const [items] = await conn.query<RowDataPacket[]>('SELECT model_snapshot FROM hr_payroll_batch_items WHERE batch_id = ?', [batchId]);
    const names = [...model.fixedFields, ...model.extendedFields].map(field => field.name);
    for (const item of items) {
      const snapshot = typeof item.model_snapshot === 'string' ? JSON.parse(item.model_snapshot) : item.model_snapshot;
      for (const field of [...(snapshot?.fixed ?? []), ...(snapshot?.extended ?? [])]) if (typeof field.name === 'string') names.push(field.name);
    }
    if (['应发', '实发', '操作', ...names].some(name => name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw badRequest('字段名称与现有工资字段重复');
    const [result] = await conn.execute<ResultSetHeader>('INSERT INTO hr_payroll_disbursement_fields (batch_id, name, category, required, display_setting, created_at) VALUES (?, ?, ?, ?, ?, NOW())', [batchId, input.name, input.category, input.required, input.displaySetting]);
    return { id: result.insertId };
  });
}

export async function setDisbursementValue(batchId: number, itemId: number, fieldId: number, value: number, revision: number, adminId: number) {
  return transaction(async conn => {
    await lockReviewedBatch(conn, batchId);
    const [items] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_payroll_batch_items WHERE id = ? AND batch_id = ?', [itemId, batchId]);
    const [fields] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_payroll_disbursement_fields WHERE id = ? AND batch_id = ?', [fieldId, batchId]);
    if (!items.length || !fields.length) throw notFound('工资明细或补充项不存在');
    const [previous] = await conn.query<RowDataPacket[]>('SELECT revision FROM hr_payroll_disbursement_values WHERE field_id = ? AND item_id = ? FOR UPDATE', [fieldId, itemId]);
    if (Number(previous[0]?.revision ?? 0) !== revision) throw conflict('补充项已被修改，请刷新后重试');
    await conn.execute('INSERT INTO hr_payroll_disbursement_values (field_id, item_id, value, revision, updated_at, updated_by) VALUES (?, ?, ?, 1, NOW(), ?) ON DUPLICATE KEY UPDATE value = VALUES(value), revision = revision + 1, updated_at = NOW(), updated_by = VALUES(updated_by)', [fieldId, itemId, value, adminId]);
    return readState(conn, batchId);
  });
}
