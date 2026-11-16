import type { CustomApprovalField, CustomApprovalType } from './api';

export const INVOICE_FIELD: CustomApprovalField = { key: 'invoiceFiles', label: '发票附件', type: 'attachment', required: true, locked: true };
export const SUPPLEMENT_FIELD: CustomApprovalField = { key: 'supplementFiles', label: '补充材料', type: 'attachment', required: false, locked: true };
const OVERTIME_LOCKED: CustomApprovalField[] = [
  { key: 'date', label: '加班日期', type: 'date', required: true, locked: true },
  { key: 'startTime', label: '开始时间', type: 'time', required: true, locked: true },
  { key: 'endTime', label: '结束时间', type: 'time', required: true, locked: true },
];

const BUILTIN_FIELDS: Record<CustomApprovalType, CustomApprovalField[]> = {
  expense: [
    { key: 'expenseType', label: '报销类型', type: 'picker', required: true, options: ['差旅费', '招待费', '办公用品', '交通费', '其他'] },
    { key: 'amount', label: '报销金额（元）', type: 'money', required: true },
    { key: 'date', label: '费用发生日期', type: 'date', required: true },
    { key: 'reason', label: '费用说明', type: 'textarea', required: true },
  ],
  leave: [
    { key: 'leaveType', label: '请假类型', type: 'picker', required: true, options: ['事假', '病假', '年假', '调休', '婚假', '产假'] },
    { key: 'startDate', label: '开始日期', type: 'date', required: true },
    { key: 'startClock', label: '开始时间', type: 'time', required: true },
    { key: 'endDate', label: '结束日期', type: 'date', required: true },
    { key: 'endClock', label: '结束时间', type: 'time', required: true },
    { key: 'days', label: '请假时长（天）', type: 'number', required: true },
    { key: 'reason', label: '请假事由', type: 'textarea', required: true },
  ],
  overtime: [
    { key: 'date', label: '加班日期', type: 'date', required: true },
    { key: 'startTime', label: '开始时间', type: 'time', required: true },
    { key: 'endTime', label: '结束时间', type: 'time', required: true },
    { key: 'reason', label: '加班事由', type: 'textarea', required: true },
  ],
  travel: [
    { key: 'city', label: '出差城市', type: 'text', required: true },
    { key: 'startDate', label: '开始日期', type: 'date', required: true },
    { key: 'endDate', label: '结束日期', type: 'date', required: true },
    { key: 'budget', label: '预算（元）', type: 'money', required: false },
    { key: 'reason', label: '出差事由', type: 'textarea', required: true },
  ],
  purchase: [
    { key: 'item', label: '采购物品', type: 'text', required: true },
    { key: 'amount', label: '预估金额（元）', type: 'money', required: true },
    { key: 'needDate', label: '期望到货日期', type: 'date', required: false },
    { key: 'reason', label: '采购说明', type: 'textarea', required: true },
  ],
};

/** 未初始化的设计稿补上原固定字段。报销附件和加班起止时间始终按固定规格保留。 */
export function composeApprovalFormFields(type: string, saved: CustomApprovalField[], initialized: boolean): CustomApprovalField[] {
  if (!(type in BUILTIN_FIELDS)) return saved.map(field => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) }));
  const keys = new Set(saved.map(field => field.key));
  const seeded = initialized ? [] : BUILTIN_FIELDS[type as CustomApprovalType].filter(field => !keys.has(field.key));
  const next = [...seeded, ...saved.map(field => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) }))];
  if (type === 'overtime') {
    for (const spec of OVERTIME_LOCKED) {
      const index = next.findIndex(field => field.key === spec.key);
      if (index >= 0) next[index] = { ...spec };
      else next.push({ ...spec });
    }
  }
  if (type !== 'expense') return next.filter(field => field.key !== INVOICE_FIELD.key && field.key !== SUPPLEMENT_FIELD.key);
  for (const spec of [INVOICE_FIELD, SUPPLEMENT_FIELD]) {
    const index = next.findIndex(field => field.key === spec.key);
    if (index >= 0) next[index] = { ...spec };
    else next.push({ ...spec });
  }
  return next;
}
