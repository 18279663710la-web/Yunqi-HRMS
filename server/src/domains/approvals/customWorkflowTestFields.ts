import { createHash } from 'node:crypto';
import { queryOne } from '../../shared/db/pool';
import { calculateLeaveDays } from '../../shared/utils/leaveDuration';
import { badRequest } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';

export interface WorkflowTestField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time' | 'picker';
  required: boolean;
  options?: string[];
  default?: string;
  maxlength?: number;
}

export async function readFixedWorkflowTestFields(type: ApprovalApproverType): Promise<WorkflowTestField[]> {
  const row = await queryOne<{ fields_json: string | WorkflowTestField[] }>('SELECT fields_json FROM approval_types WHERE `key` = ?', [type]);
  if (!row) throw badRequest('审批类型不存在');
  return normalizeFixedWorkflowTestFields(type, row.fields_json);
}

export function normalizeFixedWorkflowTestFields(type: ApprovalApproverType, data: string | WorkflowTestField[]): WorkflowTestField[] {
  const fields = typeof data === 'string' ? JSON.parse(data) as WorkflowTestField[] : data;
  const fixed = fields.filter(field => type !== 'overtime' || field.key !== 'compensation');
  if (type === 'expense') fixed.push(
    { key: '__invoice', label: '发票附件', type: 'picker', required: true, options: ['已提供', '未提供'] },
    { key: '__attachments', label: '补充材料', type: 'picker', required: false, options: ['已提供', '未提供'] },
  );
  return fixed;
}

export function hashWorkflowTestFields(fields: WorkflowTestField[]): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export function ownWorkflowValue(values: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '';
}

export function validateWorkflowTestValues(fields: WorkflowTestField[], values: Record<string, string>): string | null {
  for (const field of fields) {
    const raw = ownWorkflowValue(values, field.key);
    const value = raw.trim();
    const limit = field.maxlength || (field.type === 'textarea' ? 200 : field.type === 'text' ? 140 : 2000);
    if (raw.length > limit) return `${field.label}超过长度限制`;
    if (!value) { if (field.required) return `请填写${field.label}`; else continue; }
    if (field.type === 'picker' && !field.options?.includes(value)) return `${field.label}选项无效`;
    if (field.type === 'number' && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return `${field.label}不是有效数字`;
    if (field.type === 'money' && !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) return `${field.label}不是有效金额`;
    if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) return `${field.label}日期无效`;
    if (field.type === 'time' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return `${field.label}时间无效`;
  }
  return null;
}

export function validateWorkflowTestCase(type: ApprovalApproverType, fields: WorkflowTestField[], values: Record<string, string>): string | null {
  const error = validateWorkflowTestValues(fields, values);
  if (error) return error;
  if (type === 'travel' && values.startDate && values.endDate && values.endDate < values.startDate) return '结束日期不能早于开始日期';
  if (type === 'overtime' && values.startTime && values.endTime && values.endTime <= values.startTime) return '结束时间需晚于开始时间';
  if (type === 'expense' && values.__invoice !== '已提供') return '请提供发票附件';
  if (type === 'leave') {
    const days = calculateLeaveDays(values.startDate || '', values.startClock || '', values.endDate || '', values.endClock || '');
    if (days === null || Number(values.days) !== days) return '请假时长与起止时间不一致';
  }
  return null;
}
