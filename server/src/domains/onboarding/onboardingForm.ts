import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { badRequest } from '../../shared/utils/errors';

const scalarField = z.object({ name: z.string().trim().min(1).max(30), type: z.enum(['text', 'number', 'date']), required: z.boolean(), maxLength: z.number().int().min(1).max(500).optional(), min: z.number().finite().optional(), max: z.number().finite().optional() }).refine(v => v.min === undefined || v.max === undefined || v.min <= v.max, '最小值不能大于最大值');
const selectField = z.object({ name: z.string().trim().min(1).max(30), type: z.literal('select'), required: z.boolean(), options: z.array(z.string().trim().min(1).max(50)).min(1).max(30).refine(options => new Set(options).size === options.length, '选项不能重复') });
const attachmentField = z.object({ name: z.string().trim().min(1).max(30), type: z.literal('attachment'), required: z.boolean() });
const childField = z.union([scalarField, selectField, attachmentField]);
const tableField = z.object({ name: z.string().trim().min(1).max(30), type: z.literal('table'), required: z.boolean(), children: z.array(childField).min(1).max(30).refine(fields => new Set(fields.map(f => f.name)).size === fields.length, '子字段名称不能重复') });
const field = z.union([scalarField, selectField, attachmentField, tableField]);
export const formTemplateSchema = z.array(field).min(1).max(30).refine(fields => new Set(fields.map(f => f.name)).size === fields.length, '字段名称不能重复');
export const templateNameSchema = z.string().trim().min(1, '请填写模板名称').max(50, '模板名称不能超过 50 个字符');
export type FormField = z.infer<typeof field>;
export const defaultTemplate: FormField[] = [
  { name: '身份证号码', type: 'text', required: true, maxLength: 18 },
  { name: '联系地址', type: 'text', required: true, maxLength: 200 },
  { name: '紧急联系人', type: 'text', required: true, maxLength: 50 },
  { name: '紧急联系电话', type: 'text', required: true, maxLength: 20 },
  { name: '最高学历', type: 'text', required: false, maxLength: 50 },
];
export function validateOnboardingAttachments(photo: unknown, signature: unknown): { photo?: string; signature?: string } {
  const check = (value: unknown, label: string, types: string[]): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || value.length > 1400000) throw badRequest(`${label}格式错误或超过大小限制`);
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || !types.includes(match[1])) throw badRequest(`${label}图片格式不支持`);
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 1024 * 1024 || bytes.toString('base64') !== match[2]) throw badRequest(`${label}图片无效或超过1MB`);
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!valid) throw badRequest(`${label}图片内容无效`);
    return value;
  };
  return { photo: check(photo, '照片', ['jpeg', 'png']), signature: check(signature, '签名', ['png']) };
}
export type AttachmentRef = { id: string; name: string; size: number };
export type AnswerValue = string | number | AttachmentRef[] | Record<string, string | number | AttachmentRef[]>[];
export type AnswerValues = Record<string, AnswerValue>;
export type AnswerChange =
  | { kind: 'field'; field: string; before?: string | number; after?: string | number }
  | { kind: 'cell'; field: string; row: number; child: string; before?: string | number; after?: string | number }
  | { kind: 'addRow'; field: string; row: number; after: Record<string, string | number> }
  | { kind: 'removeRow'; field: string; row: number; before: Record<string, string | number> };

const answerValue = (value: unknown): string | number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'number' || typeof value === 'string' ? value : undefined;
};

export function answerChanges(fields: FormField[], before: Record<string, unknown>, after: Record<string, unknown>): AnswerChange[] {
  const changes: AnswerChange[] = [];
  for (const field of fields) {
    if (field.type !== 'table') {
      const previous = answerValue(before[field.name]);
      const current = answerValue(after[field.name]);
      if (previous !== current) changes.push({ kind: 'field', field: field.name, ...(previous !== undefined ? { before: previous } : {}), ...(current !== undefined ? { after: current } : {}) });
      continue;
    }
    const previousRows = Array.isArray(before[field.name]) ? (before[field.name] as Record<string, unknown>[]) : [];
    const currentRows = Array.isArray(after[field.name]) ? (after[field.name] as Record<string, unknown>[]) : [];
    const rowCount = Math.max(previousRows.length, currentRows.length);
    for (let index = 0; index < rowCount; index += 1) {
      const previousRow = previousRows[index];
      const currentRow = currentRows[index];
      if (!previousRow) {
        changes.push({ kind: 'addRow', field: field.name, row: index + 1, after: (currentRow ?? {}) as Record<string, string | number> });
        continue;
      }
      if (!currentRow) {
        changes.push({ kind: 'removeRow', field: field.name, row: index + 1, before: previousRow as Record<string, string | number> });
        continue;
      }
      for (const child of field.children) {
        const previous = answerValue(previousRow[child.name]);
        const current = answerValue(currentRow[child.name]);
        if (previous !== current) changes.push({ kind: 'cell', field: field.name, row: index + 1, child: child.name, ...(previous !== undefined ? { before: previous } : {}), ...(current !== undefined ? { after: current } : {}) });
      }
    }
  }
  return changes;
}

export function answersEqual(before: unknown, after: unknown): boolean {
  return isDeepStrictEqual(before, after);
}

export function validateAnswers(fields: FormField[], raw: unknown): Record<string, AnswerValue> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('入职信息格式错误');
  const input = raw as Record<string, unknown>; const result: Record<string, AnswerValue> = {};
  if (Object.keys(input).some(key => !fields.some(f => f.name === key))) throw badRequest('包含未定义的字段');
  for (const f of fields) {
    const value = input[f.name];
    if (value === undefined || value === null || value === '') { if (f.required) throw badRequest(`请填写${f.name}`); continue; }
    if (f.type === 'attachment') {
      const item = z.object({ id: z.string().uuid(), name: z.string().min(1).max(255), size: z.number().int().positive().max(10 * 1024 * 1024) }).strict();
      const parsed = z.array(item).max(5).safeParse(value);
      if (!parsed.success || (f.required && parsed.data.length === 0) || new Set(parsed.data.map(v => v.id)).size !== parsed.data.length) throw badRequest(`${f.name}附件无效`);
      if (parsed.data.length) result[f.name] = parsed.data;
      continue;
    }
    if (f.type === 'table') {
      if (!Array.isArray(value) || value.length > 50 || (f.required && value.length === 0)) throw badRequest(`${f.name}需要填写有效的表格内容`);
      result[f.name] = value.map(row => validateAnswers(f.children, row) as Record<string, string | number | AttachmentRef[]>);
      continue;
    }
    if (f.type === 'select') {
      if (typeof value !== 'string' || !f.options.includes(value.trim())) throw badRequest(`${f.name}选项无效`);
      result[f.name] = value.trim();
    } else if (f.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max)) throw badRequest(`${f.name}数值不符合要求`);
      result[f.name] = value;
    } else {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > (f.maxLength ?? 500)) throw badRequest(`${f.name}内容不符合要求`);
      if (f.type === 'date' && !z.string().date().safeParse(value).success) throw badRequest(`${f.name}日期无效`);
      result[f.name] = value.trim();
    }
  }
  return result;
}
