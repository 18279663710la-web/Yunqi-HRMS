import { badRequest } from '../../shared/utils/errors';
import { isBuiltinApprovalType, type ApprovalApproverType } from './expenseApproverService';
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

/** 报销附件和加班起止时间保持固定内容。已初始化的设计稿若缺了这些项，补回列表末尾。报销可另加自定义附件字段。 */
export function normalizeEditableFormFields(type: string, fields: EditableApprovalField[], initialized: boolean): EditableApprovalField[] {
  const next = fields.map(field => ({ ...field }));
  if (type === 'overtime') forceLocked(next, OVERTIME_LOCKED, initialized);
  if (type !== 'expense') {
    if (next.some(field => field.type === 'attachment')) throw badRequest('字段类型无效');
    if (next.some(field => LOCKED.some(spec => spec.key === field.key))) throw badRequest('字段名称或标识重复');
    return next;
  }
  forceLocked(next, LOCKED, initialized);
  return next;
}

export interface ExpenseAttachmentInput { name: string; fileID: string; fieldKey?: string }
export interface PartitionedExpenseAttachments {
  supplement: Array<{ name: string; fileID: string }>;
  fields: Array<{ key: string; label: string; files: Array<{ name: string; fileID: string }> }>;
}

/** 未带字段键的文件归入补充材料。自定义附件字段各自最多 9 个，必填字段至少 1 个。发票不走这条通道。 */
export function partitionExpenseAttachments(fields: EmployeeFormField[], attachments: ExpenseAttachmentInput[]): PartitionedExpenseAttachments {
  const custom = fields.filter(field => field.type === 'attachment' && field.key !== 'invoiceFiles' && field.key !== 'supplementFiles');
  const customKeys = new Map(custom.map(field => [field.key, field]));
  const supplement: Array<{ name: string; fileID: string }> = [];
  const grouped = new Map<string, Array<{ name: string; fileID: string }>>(custom.map(field => [field.key, []]));
  for (const item of attachments) {
    const name = item.name.trim();
    const fileID = item.fileID.trim();
    if (!name || !fileID) throw badRequest('请填写附件名称');
    const key = item.fieldKey?.trim() || '';
    if (!key || key === 'supplementFiles') {
      supplement.push({ name, fileID });
      continue;
    }
    if (!customKeys.has(key)) throw badRequest('附件字段无效');
    grouped.get(key)!.push({ name, fileID });
  }
  if (supplement.length > 9) throw badRequest('最多上传 9 张补充材料');
  const saved: PartitionedExpenseAttachments['fields'] = [];
  for (const field of custom) {
    const files = grouped.get(field.key) ?? [];
    if (files.length > 9) throw badRequest(`最多上传 9 张${field.label}`);
    if (field.required && !files.length) throw badRequest(`请上传${field.label}`);
    if (files.length) saved.push({ key: field.key, label: field.label, files });
  }
  return { supplement, fields: saved };
}

/** 已把原固定字段放进表单设计时，按设计顺序展示，并去掉与之重复的发布快照字段。 */
export function employeeApprovalFields(type: string, fixed: WorkflowTestField[], custom: EditableApprovalField[]): EmployeeFormField[] {
  const visibleCustom = custom.filter(field => !field.key.startsWith('__'));
  const asFieldEarly = (field: EditableApprovalField): EmployeeFormField => ({
    key: field.key, label: field.label, type: field.type, required: field.required, ...(field.options ? { options: field.options } : {}),
  });
  if (!isBuiltinApprovalType(type)) return visibleCustom.map(asFieldEarly);
  const converted = visibleCustom.some(field => field.type === 'attachment' || BUILTIN_KEYS[type].includes(field.key));
  const asField = (field: EditableApprovalField): EmployeeFormField => ({
    key: field.key, label: field.label, type: field.type, required: field.required, ...(field.options ? { options: field.options } : {}),
  });
  const visibleFixed = fixed.filter(field => !field.key.startsWith('__'));
  if (!converted) return [...visibleFixed, ...visibleCustom.map(asField)];
  const used = new Set(visibleCustom.map(field => field.key));
  return [...visibleCustom.map(asField), ...visibleFixed.filter(field => !used.has(field.key))];
}
