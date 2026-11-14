import { z } from 'zod';
import { badRequest } from '../../shared/utils/errors';

const fieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(100),
  type: z.enum(['text', 'textarea', 'number', 'money', 'date', 'time', 'picker', 'attachment']),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});
const conditionSchema = z.object({
  field: z.string().min(1).max(40),
  operator: z.enum(['eq', 'gte', 'lt']),
  value: z.string().trim().min(1).max(100),
});
const approversSchema = z.array(z.string().trim().min(1).max(10)).min(1).max(20);
const workflowSchema = z.object({
  version: z.number().int().min(1),
  enabled: z.boolean(),
  fields: z.array(fieldSchema).max(40),
  branches: z.array(z.object({ conditions: z.array(conditionSchema).min(1).max(20), approvers: approversSchema })).max(30),
});
type ExpenseWorkflow = z.infer<typeof workflowSchema>;
export interface WorkflowFieldPolicy { reserved: string[]; labels: string[]; numericField?: string; choices: Record<string, string[]> }

function cents(value: string, error = '请输入有效报销金额'): number {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) throw badRequest(error);
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function validateWorkflowConditions(input: unknown, policy: WorkflowFieldPolicy): ExpenseWorkflow {
  const result = workflowSchema.safeParse(input);
  if (!result.success) throw badRequest('审批流程配置无效');
  const workflow = result.data;
  const reserved = new Set(policy.reserved);
  const labels = new Set(policy.labels);
  const keys = new Set<string>();
  for (const field of workflow.fields) {
    if (keys.has(field.key) || reserved.has(field.key) || labels.has(field.label)) throw badRequest('字段名称或标识重复');
    keys.add(field.key); labels.add(field.label);
    if (field.type === 'picker' && (!field.options?.length || new Set(field.options).size !== field.options.length)) throw badRequest('单选字段选项无效');
    if (field.type !== 'picker' && field.options?.length) throw badRequest('只有单选字段可配置选项');
  }
  const uniqueApprovers = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw badRequest('同一分支审批人不能重复'); };
  const ranges: Array<{ min: number; max: number; selections: Map<string, string> }> = [];
  for (const branch of workflow.branches) {
    uniqueApprovers(branch.approvers);
    const range = { min: 0, max: Infinity, selections: new Map<string, string>() };
    for (const condition of branch.conditions) {
      if (condition.field === policy.numericField) {
        if (condition.operator === 'eq') throw badRequest('数值条件只能使用大于等于或小于');
        const value = cents(condition.value, '请输入有效的分支数值');
        if (condition.operator === 'gte') range.min = Math.max(range.min, value);
        else range.max = Math.min(range.max, value);
      } else {
        const owned = workflow.fields.find(item => item.key === condition.field);
        const preset = policy.choices[condition.field];
        const field = owned ?? (preset ? { type: 'picker' as const, options: preset } : undefined);
        if (!field || field.type !== 'picker' || condition.operator !== 'eq' || !field.options?.includes(condition.value)) throw badRequest('分支条件无效');
        const previous = range.selections.get(condition.field);
        if (previous && previous !== condition.value) throw badRequest('分支条件互相矛盾');
        range.selections.set(condition.field, condition.value);
      }
    }
    if (range.min >= range.max) throw badRequest('分支金额条件互相矛盾');
    for (const other of ranges) {
      const selectionsOverlap = [...range.selections].every(([key, value]) => !other.selections.has(key) || other.selections.get(key) === value);
      if (selectionsOverlap && Math.max(range.min, other.min) < Math.min(range.max, other.max)) throw badRequest('审批分支条件不能重叠');
    }
    ranges.push(range);
  }
  return workflow;
}
