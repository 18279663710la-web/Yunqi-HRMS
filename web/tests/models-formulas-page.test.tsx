import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelsFormulasView } from '../src/pages/ModelsFormulas';

test('超级管理员查看出勤率绩效时只展示对应规则', () => {
  const html = renderToStaticMarkup(<App><ModelsFormulasView role="super_admin" section="attendance" /></App>);
  assert.equal(html.split('出勤率绩效规则').length - 1, 1);
  assert.match(html, /type="submit"/);
  assert.ok(!html.includes('加班绩效规则'));
});

test('超级管理员查看加班绩效时只展示对应规则', () => {
  const html = renderToStaticMarkup(<App><ModelsFormulasView role="super_admin" section="overtime" /></App>);
  assert.equal(html.split('加班绩效规则').length - 1, 1);
  assert.ok(!html.includes('出勤率绩效规则'));
});

test('非超级管理员不能进入规则管理页面', () => {
  const html = renderToStaticMarkup(<App><ModelsFormulasView role="hr_admin" section="attendance" /></App>);
  assert.ok(html.includes('仅超级管理员可访问模型与公式'));
  assert.ok(!html.includes('出勤率绩效规则'));
  assert.ok(!html.includes('加班绩效规则'));
});

test('薪资构成模型是独立子页面且限制超级管理员', () => {
  const html = renderToStaticMarkup(<App><ModelsFormulasView role="super_admin" section="salary" /></App>);
  assert.ok(html.includes('薪资构成模型'));
  assert.ok(html.includes('创建固定字段'));
  assert.ok(html.includes('创建扩展字段'));
  assert.ok(!html.includes('薪资模型列表'));
  assert.ok(!html.includes('panel-card'));
  assert.match(html, /<button[^>]*>[^<]*创建固定字段<\/button>/);
  assert.match(html, /<button[^>]*>[^<]*创建扩展字段<\/button>/);
  assert.match(html, /<button[^>]*disabled[^>]*>编辑<\/button>/);
  assert.match(html, /<button[^>]*disabled[^>]*>删除<\/button>/);
  assert.ok(!html.includes('新建模型'));
  assert.ok(!html.includes('出勤率绩效规则'));
  const denied = renderToStaticMarkup(<App><ModelsFormulasView role="hr_admin" section="salary" /></App>);
  assert.ok(denied.includes('仅超级管理员可访问模型与公式'));
  assert.ok(!/编\s*辑/.test(denied));
});

test('入职申请表设置是独立子页面且限制超级管理员', () => {
  const html = renderToStaticMarkup(<App><ModelsFormulasView role="super_admin" section="onboarding-template" /></App>);
  assert.ok(html.includes('入职申请表设置'));
  assert.ok(html.includes('修改历史'));
  assert.ok(html.includes('新建模板'));
  assert.ok(!html.includes('出勤率绩效规则'));
  assert.ok(!html.includes('加班绩效规则'));
  const denied = renderToStaticMarkup(<App><ModelsFormulasView role="hr_admin" section="onboarding-template" /></App>);
  assert.ok(denied.includes('仅超级管理员可访问模型与公式'));
  assert.ok(!denied.includes('新建模板'));
});

test('薪资发放流程是独立子页面且限制超级管理员', () => {
  const html = renderToStaticMarkup(<App><ModelsFormulasView role="super_admin" section="payroll-workflow" /></App>);
  assert.ok(html.includes('薪资发放流程'));
  assert.ok(html.includes('添加节点'));
  assert.ok(html.includes('选择模式'));
  assert.ok(html.includes('平移模式'));
  const denied = renderToStaticMarkup(<App><ModelsFormulasView role="hr_admin" section="payroll-workflow" /></App>);
  assert.ok(denied.includes('仅超级管理员可访问模型与公式'));
  assert.ok(!denied.includes('添加节点'));
});
