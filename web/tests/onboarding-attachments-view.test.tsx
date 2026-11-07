import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingSubmission } from '../src/modules/hr/onboarding/OnboardingSubmission';

test('入职资料的普通字段和表格子字段均展示附件名称', () => {
  const html = renderToStaticMarkup(<App><OnboardingSubmission record={{
    template: [{ name: '个人资料', type: 'attachment' }, { name: '教育经历', type: 'table', children: [{ name: '证明材料', type: 'attachment' }] }],
    answers: { 个人资料: [{ id: 'one', name: '身份证.jpg', size: 10 }], 教育经历: [{ 证明材料: [{ id: 'two', name: '毕业证明.pdf', size: 20 }] }] },
    archivedAt: '2026-01-01', submittedAt: '2026-01-01',
  }} /></App>);
  assert.ok(html.includes('身份证.jpg'));
  assert.ok(html.includes('毕业证明.pdf'));
  assert.ok(!html.includes('[object Object]'));
});
