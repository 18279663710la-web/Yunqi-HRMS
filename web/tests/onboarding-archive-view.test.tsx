import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { OnboardingSubmission } from '../src/modules/hr/onboarding/OnboardingSubmission';
test('员工个人信息以只读方式显示封存字段、表格、照片、签名和声明', () => {
 const html=renderToStaticMarkup(<OnboardingSubmission record={{template:[{name:'姓名'},{name:'教育经历',children:[{name:'学校'}]}],answers:{姓名:'测试员工',教育经历:[{学校:'测试学校'}]},photo:'data:image/png;base64,abc',signature:'data:image/png;base64,def',declaration:'声明内容',declarationAccepted:true,submittedAt:'2026-11-01',archivedAt:'2026-11-01'}} />);
 for (const text of ['姓名','测试员工','教育经历','测试学校','员工照片','员工手写签名','声明内容','员工已勾选确认']) assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<input|<textarea|<button/);
});
