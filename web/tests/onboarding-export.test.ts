import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createOnboardingWorkbook } from '../src/modules/models-formulas/onboarding-template/onboardingExcel';

test('导出工作簿包含普通字段、单选、表格子字段和固定声明签名区域', async () => {
  const workbook = createOnboardingWorkbook('入职表', [
    { name: '姓名', type: 'text', required: true, maxLength: 30 },
    { name: '性别', type: 'select', required: true, options: ['男', '女'] },
    { name: '教育经历', type: 'table', required: false, children: [
      { name: '学校', type: 'text', required: true }, { name: '学历', type: 'select', required: false, options: ['本科', '硕士'] },
    ] },
  ]);
  const buffer = await workbook.xlsx.writeBuffer(); const parsed = new ExcelJS.Workbook(); await parsed.xlsx.load(buffer);
  const sheet = parsed.getWorksheet('入职申请表'); assert.ok(sheet);
  const text: string[] = []; sheet.eachRow(row => row.eachCell(cell => { if (typeof cell.value === 'string') text.push(cell.value); }));
  for (const label of ['入职表', '姓名 *', '性别 *', '教育经历', '学校 *', '学历', '照片', '声明', '签名 *', '日期']) assert.ok(text.includes(label), `缺少 ${label}`);
  assert.ok(text.some(value => value.includes('本人保证所填写的上述信息真实')));
  const instructions = parsed.getWorksheet('填写说明'); assert.ok(instructions);
  const instructionsText: string[] = []; instructions.eachRow(row => row.eachCell(cell => { if (typeof cell.value === 'string') instructionsText.push(cell.value); }));
  assert.ok(instructionsText.some(value => value.includes('男、女'))); assert.ok(instructionsText.includes('教育经历 / 学历'));
  assert.ok(sheet.rowCount >= 12); assert.ok(Object.keys(sheet.model.merges).length > 0);
});
