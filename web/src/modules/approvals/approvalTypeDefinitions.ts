import type { CustomApprovalNodeKind, CustomApprovalType } from './api';

interface ApprovalTypeDefinition {
  name: string;
  fixedFields: string[];
  reservedLabels?: string[];
  numericCondition?: { value: string; label: string };
  choices: Array<{ value: string; label: string; options: string[] }>;
}

export const APPROVAL_TYPE_DEFINITIONS: Record<CustomApprovalType, ApprovalTypeDefinition> = {
  expense: { name: '报销', fixedFields: ['发票附件', '补充材料'], numericCondition: { value: 'amount', label: '报销金额（元）' }, choices: [{ value: 'expenseType', label: '报销类型', options: ['差旅费', '招待费', '办公用品', '交通费', '其他'] }] },
  leave: { name: '请假', fixedFields: [], numericCondition: { value: 'days', label: '请假时长（天）' }, choices: [{ value: 'leaveType', label: '请假类型', options: ['事假', '病假', '年假', '调休', '婚假', '产假'] }] },
  overtime: { name: '加班', fixedFields: ['加班日期', '开始时间', '结束时间'], reservedLabels: ['补偿方式'], choices: [] },
  travel: { name: '出差', fixedFields: [], numericCondition: { value: 'budget', label: '预算（元）' }, choices: [] },
  purchase: { name: '采购', fixedFields: [], numericCondition: { value: 'amount', label: '预估金额（元）' }, choices: [] },
};

export function isNodeAvailable(type: CustomApprovalType | undefined, kind: CustomApprovalNodeKind): boolean {
  return kind !== 'form' && (!['verify', 'ai'].includes(kind) || type === 'expense');
}
