import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingForms } from '../src/pages/OnboardingForms';

test('入职管理只保留入职申请，不再展示入职申请表设置', () => {
  const html = renderToStaticMarkup(<App><OnboardingForms /></App>);
  assert.ok(html.includes('入职申请'));
  assert.ok(html.includes('登记申请'));
  assert.ok(!html.includes('入职申请表设置'));
  assert.ok(!html.includes('新建模板'));
});
