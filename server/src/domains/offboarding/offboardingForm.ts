import type { FormField } from '../onboarding/onboardingForm';

export { answersEqual, formTemplateSchema, templateNameSchema, type FormField } from '../onboarding/onboardingForm';

/** 空库首次访问时写入的标准离职申请表字段。 */
export const defaultOffboardingTemplate: FormField[] = [
  { name: '离职原因', type: 'select', required: true, options: ['个人发展', '家庭原因', '薪资福利', '工作环境', '其他'] },
  { name: '最后工作日', type: 'date', required: true },
  { name: '工作交接说明', type: 'text', required: true, maxLength: 500 },
  { name: '联系电话', type: 'text', required: true, maxLength: 20 },
];
