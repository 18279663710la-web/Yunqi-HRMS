import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { transaction } from '../../shared/db/pool';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { calculateDisbursementNet, type DisbursementCategory } from '../../domains/payroll/payrollDisbursementCalculation';
import { readSalaryModel } from '../../domains/payroll/salaryModelService';
import { createHash } from 'node:crypto';

export interface DisbursementFieldInput { name: string; category: DisbursementCategory; required: boolean; displaySetting: 'none' | 'display' | 'output' }
async function lockReviewedBatch(conn: PoolConnection, batchId: number) {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT id, payroll_month AS month, status, created_at AS createdAt, reviewed_at AS reviewedAt FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [batchId]);
  if (!rows.length) throw notFound('工资批次不存在');
  if (rows[0].status !== 'reviewed') throw badRequest('只能处理已复核的工资批次');
  return rows[0];
}

async function findIssued(conn: PoolConnection, batchId: number) {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT id, snapshot_json AS snapshot FROM hr_payroll_disbursement_records WHERE batch_id = ?', [batchId]);
  return rows[0];
}

async function readState(conn: PoolConnection, batchId: number) {
  const [fields] = await conn.query<RowDataPacket[]>('SELECT id, name, category, required, display_setting AS displaySetting FROM hr_payroll_disbursement_fields WHERE batch_id = ? ORDER BY id', [batchId]);
  const [items] = await conn.query<RowDataPacket[]>('SELECT id, gross FROM hr_payroll_batch_items WHERE batch_id = ? ORDER BY id', [batchId]);
  const [values] = await conn.query<RowDataPacket[]>('SELECT v.item_id AS itemId, v.field_id AS fieldId, v.value, v.revision FROM hr_payroll_disbursement_values v JOIN hr_payroll_disbursement_fields f ON f.id = v.field_id JOIN hr_payroll_batch_items i ON i.id = v.item_id AND i.batch_id = f.batch_id WHERE f.batch_id = ?', [batchId]);
  const valuesByKey = new Map(values.map(value => [`${value.itemId}:${value.fieldId}`, value]));
  const state = {
    fields: fields.map(field => ({ id: Number(field.id), name: field.name as string, category: field.category as DisbursementCategory, required: !!field.required, displaySetting: field.displaySetting as DisbursementFieldInput['displaySetting'] })),
    rows: items.map(item => {
      const itemValues = fields.map(field => {
        const stored = valuesByKey.get(`${item.id}:${field.id}`);
        return { fieldId: Number(field.id), value: Number(stored?.value ?? 0), revision: Number(stored?.revision ?? 0) };
      });
      return { itemId: Number(item.id), net: calculateDisbursementNet(Number(item.gross), fields.map((field, index) => ({ category: field.category as DisbursementCategory, value: itemValues[index].value }))), values: itemValues };
    }),
  };
  return { ...state, revision: createHash('sha256').update(JSON.stringify(state)).digest('hex') };
}

async function readSnapshotState(conn: PoolConnection, batchId: number) {
  const state = await readState(conn, batchId);
  const [items] = await conn.query<(RowDataPacket & { gross: number; modelSnapshot: unknown })[]>('SELECT i.id, i.employee_id AS employeeId, e.name, e.employee_no AS employeeNo, i.gross, i.base_gross AS baseGross, i.attendance_rate AS attendanceRate, i.attendance_adjustment AS attendanceAdjustment, i.overtime_seconds AS overtimeSeconds, i.overtime_pay AS overtimePay, i.model_snapshot AS modelSnapshot, e.position, i.deductions, i.net, i.note FROM hr_payroll_batch_items i JOIN employees e ON e.id = i.employee_id WHERE i.batch_id = ? ORDER BY i.id', [batchId]);
  const normalizedItems = items.map(item => ({ ...item, modelSnapshot: typeof item.modelSnapshot === 'string' ? JSON.parse(item.modelSnapshot) : item.modelSnapshot }));
  if (items.length !== state.rows.length) throw badRequest('工资批次员工明细不完整');
  const model = await readSalaryModel(conn);
  const snapshot = { items: normalizedItems, model };
  const revision = createHash('sha256').update(JSON.stringify({ fields: state.fields, rows: state.rows, snapshot })).digest('hex');
  return { ...state, revision, snapshot };
}

export async function getDisbursement(batchId: number) {
  return transaction(async conn => {
    await lockReviewedBatch(conn, batchId);
    const record = await findIssued(conn, batchId);
    if (record) {
      const snapshot = typeof record.snapshot === 'string' ? JSON.parse(record.snapshot) : record.snapshot;
      return { ...snapshot.disbursement, issued: true, recordId: Number(record.id), snapshot: { items: snapshot.items, model: snapshot.model } };
    }
    return { ...await readSnapshotState(conn, batchId), issued: false };
  });
}

export async function addDisbursementField(batchId: number, input: DisbursementFieldInput) {
  return transaction(async conn => {
    await lockReviewedBatch(conn, batchId);
    if (await findIssued(conn, batchId)) throw conflict('该批次已发放，不能修改');
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
    if (await findIssued(conn, batchId)) throw conflict('该批次已发放，不能修改');
    const [items] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_payroll_batch_items WHERE id = ? AND batch_id = ?', [itemId, batchId]);
    const [fields] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_payroll_disbursement_fields WHERE id = ? AND batch_id = ?', [fieldId, batchId]);
    if (!items.length || !fields.length) throw notFound('工资明细或补充项不存在');
    const [previous] = await conn.query<RowDataPacket[]>('SELECT revision FROM hr_payroll_disbursement_values WHERE field_id = ? AND item_id = ? FOR UPDATE', [fieldId, itemId]);
    if (Number(previous[0]?.revision ?? 0) !== revision) throw conflict('补充项已被修改，请刷新后重试');
    await conn.execute('INSERT INTO hr_payroll_disbursement_values (field_id, item_id, value, revision, updated_at, updated_by) VALUES (?, ?, ?, 1, NOW(), ?) ON DUPLICATE KEY UPDATE value = VALUES(value), revision = revision + 1, updated_at = NOW(), updated_by = VALUES(updated_by)', [fieldId, itemId, value, adminId]);
    return readSnapshotState(conn, batchId);
  });
}

export async function issueDisbursement(batchId: number, revision: string, adminId: number) {
  return transaction(async conn => {
    const batch = await lockReviewedBatch(conn, batchId);
    if (await findIssued(conn, batchId)) throw conflict('该批次已发放');
    const fullState = await readSnapshotState(conn, batchId);
    const { snapshot: frozen, ...disbursement } = fullState;
    if (revision !== disbursement.revision) throw conflict('工资发放数据已更改，请刷新后重新发放');
    if (!frozen.items.length) throw badRequest('工资批次没有员工明细');
    const snapshot = { batch: { id: Number(batch.id), month: batch.month, status: 'reviewed', createdAt: batch.createdAt, reviewedAt: batch.reviewedAt }, ...frozen, disbursement };
    const grossTotal = frozen.items.reduce((sum, item) => sum + Math.round(Number(item.gross) * 100), 0) / 100;
    const netTotal = disbursement.rows.reduce((sum, row) => sum + Math.round(row.net * 100), 0) / 100;
    const [result] = await conn.execute<ResultSetHeader>('INSERT INTO hr_payroll_disbursement_records (batch_id, payroll_month, gross_total, net_total, note, snapshot_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)', [batchId, batch.month, grossTotal, netTotal, '', JSON.stringify(snapshot), adminId]);
    return { id: result.insertId };
  });
}
