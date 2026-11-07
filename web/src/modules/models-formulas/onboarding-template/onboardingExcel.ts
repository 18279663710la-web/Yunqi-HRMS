import ExcelJS from 'exceljs';

export type ExportField = { name: string; type: 'text' | 'number' | 'date' | 'select' | 'attachment' | 'table'; required: boolean; maxLength?: number; min?: number; max?: number; options?: string[]; children?: ExportField[] };
const declaration = '本人保证所填写的上述信息真实、准确。如因提供虚假或遗漏相关信息导致用人单位误解而与本人签订劳动合同的，在试用期内，用人单位可以本人不符合录用条件而解除劳动合同；在试用期过后劳动合同期限内，用人单位可以因本人严重违反用人单位的规章制度而与本人解除劳动合同关系。';
const border: Partial<ExcelJS.Borders> = { top: { style: 'thin', color: { argb: 'FFB6C3D4' } }, bottom: { style: 'thin', color: { argb: 'FFB6C3D4' } }, left: { style: 'thin', color: { argb: 'FFB6C3D4' } }, right: { style: 'thin', color: { argb: 'FFB6C3D4' } } };

export function createOnboardingWorkbook(name: string, fields: ExportField[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const columns = Math.max(6, ...fields.filter(f => f.type === 'table').map(f => f.children?.length ?? 0));
  const sheet = workbook.addWorksheet('入职申请表', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } } });
  sheet.columns = Array.from({ length: columns }, () => ({ width: Math.max(8, 84 / columns) }));
  let row = 1;
  const cell = (r: number, first: number, last: number, value: string, label = false) => {
    if (last > first) sheet.mergeCells(r, first, r, last);
    const target = sheet.getCell(r, first); target.value = value;
    target.font = { name: '微软雅黑', size: 10, bold: label, color: { argb: 'FF26364D' } };
    target.alignment = { vertical: 'middle', horizontal: label ? 'center' : 'left', wrapText: true };
    target.border = border;
    if (label) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5FA' } };
    return target;
  };
  const label = (f: ExportField) => `${f.name}${f.required ? ' *' : ''}`;
  const note = (f: ExportField) => [f.required ? '必填' : '选填', f.type === 'select' ? `选项：${(f.options ?? []).join('、')}` : '', f.type === 'attachment' ? '通过小程序上传附件' : '', f.type === 'text' && f.maxLength ? `最多 ${f.maxLength} 个字符` : '', f.type === 'number' && f.min !== undefined ? `最小值：${f.min}` : '', f.type === 'number' && f.max !== undefined ? `最大值：${f.max}` : '', f.type === 'date' ? '请填写日期' : ''].filter(Boolean).join('；');
  cell(row, 1, columns, name, true).font = { name: '微软雅黑', size: 16, bold: true, color: { argb: 'FF203858' } }; sheet.getRow(row++).height = 36;
  cell(row, 1, 2, '照片', true); cell(row, 3, columns, ''); sheet.getRow(row++).height = 54;
  for (const field of fields) {
    if (field.type !== 'table') {
      const target = cell(row, 1, 2, label(field), true); target.note = note(field);
      const value = cell(row, 3, columns, ''); if (field.type === 'select') value.note = note(field);
      sheet.getRow(row++).height = 30; continue;
    }
    cell(row, 1, columns, label(field), true).note = field.required ? '至少填写一行' : '选填'; sheet.getRow(row++).height = 25;
    const children = field.children ?? [];
    children.forEach((child, i) => { const first = Math.floor(i * columns / children.length) + 1; const last = Math.floor((i + 1) * columns / children.length); cell(row, first, last, label(child), true).note = note(child); });
    sheet.getRow(row++).height = 27;
    for (let n = 0; n < 4; n++) { children.forEach((child, i) => { const first = Math.floor(i * columns / children.length) + 1; const last = Math.floor((i + 1) * columns / children.length); const target = cell(row, first, last, ''); if (child.type === 'select') target.note = note(child); }); sheet.getRow(row++).height = 27; }
  }
  cell(row, 1, 2, '声明', true); cell(row, 3, columns, declaration); sheet.getRow(row++).height = 80;
  cell(row, 1, 2, '签名 *', true); const middle = Math.max(3, Math.floor((columns + 2) / 2)); cell(row, 3, middle, ''); cell(row, middle + 1, middle + 1, '日期', true); cell(row, middle + 2, columns, ''); sheet.getRow(row).height = 34;
  const instructions = workbook.addWorksheet('填写说明');
  instructions.columns = [{ header: '字段', key: 'field', width: 32 }, { header: '填写要求', key: 'details', width: 75 }];
  instructions.getRow(1).font = { bold: true, name: '微软雅黑', color: { argb: 'FF203858' } };
  for (const field of fields) {
    if (field.type === 'table') {
      instructions.addRow({ field: field.name, details: field.required ? '至少填写一行' : '选填' });
      for (const child of field.children ?? []) instructions.addRow({ field: `${field.name} / ${child.name}`, details: note(child) });
    } else instructions.addRow({ field: field.name, details: note(field) });
  }
  instructions.eachRow(row => { row.height = 24; row.eachCell(c => { c.alignment = { vertical: 'middle', wrapText: true }; c.border = border; }); });
  return workbook;
}

export async function downloadOnboardingWorkbook(name: string, fields: ExportField[]): Promise<void> {
  const buffer = await createOnboardingWorkbook(name, fields).xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || '入职申请表'}.xlsx`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
