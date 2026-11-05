import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from 'antd';
import { HrContractFiles } from '../src/pages/HrContractFiles';
test('劳动合同文件区域显示导入入口及立即保存说明', () => {
 const html = renderToStaticMarkup(<App><HrContractFiles employeeId="U001" /></App>);
 for (const text of ['合同文件', '导入', '.pdf,.doc,.docx,.jpg,.jpeg,.png', '导入后立即保存']) assert.ok(html.includes(text),text);
});
