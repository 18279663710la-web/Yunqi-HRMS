import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingForms } from '../src/modules/hr/onboarding/OnboardingForms';

test('入职管理将登记入口放在功能区，保留申请列表且不显示外围卡片', () => {
  const html = renderToStaticMarkup(<App><OnboardingForms /></App>);
  assert.match(html, /role="toolbar"[^>]*aria-label="入职管理操作"/);
  assert.ok(html.includes('登记申请'));
  for (const title of ['申请编号', '员工账号', '预计入职日期', '填写状态', '登记时间', '操作']) assert.ok(html.includes(title));
  assert.doesNotMatch(html, /ant-card/);
  assert.ok(!html.includes('入职申请表设置'));
  assert.ok(!html.includes('新建模板'));
});
