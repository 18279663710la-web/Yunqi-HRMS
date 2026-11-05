import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnboardingAttachments } from '../src/domains/onboarding/onboardingForm';
import { formTemplateSchema } from '../src/domains/onboarding/onboardingForm';
import { paperOnboardingTemplate } from '../src/domains/onboarding/paperOnboardingTemplate';

test('入职照片与签名必须为有效的受限格式图片', () => {
  const photo = 'data:image/jpeg;base64,/9j/2Q==';
  const signature = 'data:image/png;base64,iVBORw0KGgo=';
  assert.deepEqual(validateOnboardingAttachments(photo, signature), { photo, signature });
  assert.throws(() => validateOnboardingAttachments('', signature));
  assert.throws(() => validateOnboardingAttachments('data:image/jpeg;base64,YWJj', signature));
  assert.throws(() => validateOnboardingAttachments(photo, 'data:image/png;base64,%%%'));
  assert.throws(() => validateOnboardingAttachments(photo, `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}`));
});

test('纸质申请表模板包含基础资料及教育、工作经历表格', () => {
  const fields = formTemplateSchema.parse(paperOnboardingTemplate);
  assert.ok(fields.some(f => f.name === '身份证号码'));
  const education = fields.find(f => f.name === '教育经历');
  assert.ok(education && education.type === 'table');
  assert.deepEqual(education.children.map(f => f.name), ['起止时间', '学校', '学历或资格证书']);
  const employment = fields.find(f => f.name === '工作经历');
  assert.ok(employment && employment.type === 'table');
  assert.deepEqual(employment.children.map(f => f.name), ['起止时间', '工作单位', '职务']);
});
