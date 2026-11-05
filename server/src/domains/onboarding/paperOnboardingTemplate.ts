import type { FormField } from './onboardingForm';

const text = (name: string, maxLength = 100): Extract<FormField, { type: 'text' | 'number' | 'date' }> => ({ name, type: 'text', required: false, maxLength });
export const paperOnboardingTemplate: FormField[] = [
  text('姓名', 50), text('性别', 20), text('出生年月', 20),
  text('学历', 50), text('婚否', 20), text('民族', 50), text('专业', 100), text('毕业学校', 100),
  text('健康状况', 100), text('户籍所在地', 200), text('身份证号码', 18),
  { name: '参加工作时间', type: 'date', required: false }, text('联系电话', 20), text('电子邮件', 100),
  text('联系地址', 200), text('原工作单位', 200), text('离职原因', 500),
  { name: '教育经历', type: 'table', required: false, children: [text('起止时间', 100), text('学校', 100), text('学历或资格证书', 200)] },
  { name: '工作经历', type: 'table', required: false, children: [text('起止时间', 100), text('工作单位', 200), text('职务', 100)] },
  { name: '日期', type: 'date', required: false },
];
