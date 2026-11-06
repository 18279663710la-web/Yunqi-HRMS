import assert from 'node:assert/strict';
import test from 'node:test';
import { onboardingFieldsSchema } from '../src/admin/hr/hrPolicy';

test('入职表字段名称不能为空或重复', () => {
  assert.equal(onboardingFieldsSchema.safeParse(['姓名', '电话']).success, true);
  assert.equal(onboardingFieldsSchema.safeParse(['姓名', ' 姓名 ']).success, false);
  assert.equal(onboardingFieldsSchema.safeParse(['']).success, false);
});
