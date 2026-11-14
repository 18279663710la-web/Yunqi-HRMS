import { badRequest } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';
import type { WorkflowTestField } from './customWorkflowTestFields';

export interface EditableApprovalField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time' | 'picker' | 'attachment';
  required: boolean;
  options?: string[];
  locked?: boolean;
}

export type EmployeeFormField = Omit<WorkflowTestField, 'type'> & { type: WorkflowTestField['type'] | 'attachment' };

const BUILTIN_KEYS: Record<ApprovalApproverType, string[]> = {
  expense: ['expenseType', 'amount', 'date', 'reason'],
  leave: ['leaveType', 'startDate', 'startClock', 'endDate', 'endClock', 'days', 'reason'],
  overtime: ['date', 'startTime', 'endTime', 'reason'],
  travel: ['city', 'startDate', 'endDate', 'budget', 'reason'],
  purchase: ['item', 'amount', 'needDate', 'reason'],
};

const LOCKED: EditableApprovalField[] = [
  { key: 'invoiceFiles', label: '发票附件', type: 'attachment', required: true, locked: true },
  { key: 'supplementFiles', label: '补充材料', type: 'attachment', required: false, locked: true },
];

const OVERTIME_LOCKED: EditableApprovalField[] = [
  { key: 'date', label: '加班日期', type: 'date', required: true, locked: true },
  { key: 'startTime', label: '开始时间', type: 'time', required: true, locked: true },
  { key: 'endTime', label: '结束时间', type: 'time', required: true, locked: true },
];

function forceLocked(fields: EditableApprovalField[], specs: EditableApprovalField[], initialized: boolean): void {
  for (const spec of specs) {
    const index = fields.findIndex(field => field.key === spec.key);
    if (index >= 0) fields[index] = { ...spec };
    else if (initialized) fields.push({ ...spec });
  }
}

/** 报销附件和加班起止时间保持固定内容。已初始化的设计稿若缺了这些项，补回列表末尾。 */
export function normalizeEditableFormFields(type: ApprovalApproverType, fields: EditableApprovalField[], initialized: boolean): EditableApprovalField[] {
  const next = fields.map(field => ({ ...field }));
  if (type === 'overtime') forceLocked(next, OVERTIME_LOCKED, initialized);
  if (type !== 'expense') {
    if (next.some(field => LOCKED.some(spec => spec.key === field.key) || field.type === 'attachment')) throw badRequest('字段名称或标识重复');
    return next;
  }
  forceLocked(next, LOCKED, initialized);
  if (next.some(field => field.type === 'attachment' && !LOCKED.some(spec => spec.key === field.key))) throw badRequest('字段类型无效');
  return next;
}

/** 已把原固定字段放进表单设计时，按设计顺序展示，并去掉与之重复的发布快照字段。 */
export function employeeApprovalFields(type: ApprovalApproverType, fixed: WorkflowTestField[], custom: EditableApprovalField[]): EmployeeFormField[] {
  const visibleCustom = custom.filter(field => !field.key.startsWith('__'));
  const converted = visibleCustom.some(field => field.type === 'attachment' || BUILTIN_KEYS[type].includes(field.key));
  const asField = (field: EditableApprovalField): EmployeeFormField => ({
    key: field.key, label: field.label, type: field.type, required: field.required, ...(field.options ? { options: field.options } : {}),
  });
  const visibleFixed = fixed.filter(field => !field.key.startsWith('__'));
  if (!converted) return [...visibleFixed, ...visibleCustom.map(asField)];
  const used = new Set(visibleCustom.map(field => field.key));
  return [...visibleCustom.map(asField), ...visibleFixed.filter(field => !used.has(field.key))];
}
