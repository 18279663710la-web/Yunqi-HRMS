import { Alert, Empty, Form, Input, InputNumber } from 'antd';
import type { ReactNode } from 'react';
import type { SalaryComponentModel, SalaryModelField } from '../api';
import { salaryAmountFields } from '../../models-formulas/salary/salaryModel';

function FieldHeader({ label, required = false }: { label: string; required?: boolean }) {
  return <th scope="col">{required && <span className="employee-record-required" aria-hidden="true">*</span>}{label}</th>;
}

function FieldTable({ label, headers, cells }: { label: string; headers: ReactNode; cells: ReactNode }) {
  return <div className="employee-record-fields-scroll" role="region" aria-label={`${label}字段`} tabIndex={0}>
    <table className="employee-record-fields-table" aria-label={label}>
      <thead><tr>{headers}</tr></thead>
      <tbody><tr>{cells}</tr></tbody>
    </table>
  </div>;
}

export function ContractFields() {
  return <FieldTable label="劳动合同" headers={<>
    <FieldHeader label="合同编号" required /><FieldHeader label="合同开始日期" required /><FieldHeader label="合同结束日期" required /><FieldHeader label="备注" />
  </>} cells={<>
    <td><Form.Item name="number" rules={[{ required: true, whitespace: true, message: '请填写合同编号' }]}><Input aria-label="合同编号" aria-required="true" maxLength={200} /></Form.Item></td>
    <td><Form.Item name="startDate" rules={[{ required: true, message: '请选择合同开始日期' }]}><Input aria-label="合同开始日期" aria-required="true" type="date" /></Form.Item></td>
    <td><Form.Item name="endDate" dependencies={['startDate']} rules={[{ required: true, message: '请选择合同结束日期' }, ({ getFieldValue }) => ({ validator(_, value: string) { return !value || !getFieldValue('startDate') || value >= getFieldValue('startDate') ? Promise.resolve() : Promise.reject(new Error('合同结束日期不能早于开始日期')); } })]}><Input aria-label="合同结束日期" aria-required="true" type="date" /></Form.Item></td>
    <td><Form.Item name="note"><Input.TextArea aria-label="备注" maxLength={200} autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item></td>
  </>} />;
}

function salaryFieldLabel(field: SalaryModelField): string {
  return field.type === 'number' && field.category !== 'info' ? `${field.name}（元）` : field.name;
}

export function SalaryFields({ currentPosition, model, modelFailed }: { currentPosition: string; model: SalaryComponentModel | null; modelFailed: boolean }) {
  const fields = salaryAmountFields(model);
  return <>
    {modelFailed && <Alert type="error" message="薪资构成模型加载失败" />}
    <FieldTable label="定薪与薪资构成" headers={<>
      <FieldHeader label="职务" /><FieldHeader label="定薪生效日期" />
      {fields.map(field => <FieldHeader key={field.name} label={salaryFieldLabel(field)} required={field.required} />)}
      <FieldHeader label="备注" />
    </>} cells={<>
      <td>{currentPosition || '—'}</td>
      <td><Form.Item name="effectiveDate"><Input aria-label="定薪生效日期" type="date" /></Form.Item></td>
      {fields.map(field => <td key={field.name}><Form.Item name={['values', field.name]} rules={field.required ? [{ required: true, message: `请填写${field.name}` }] : undefined}>{field.type === 'text' ? <Input aria-label={salaryFieldLabel(field)} aria-required={field.required || undefined} maxLength={200} /> : <InputNumber aria-label={salaryFieldLabel(field)} aria-required={field.required || undefined} min={0} max={9999999999.99} precision={2} style={{ width: '100%' }} />}</Form.Item></td>)}
      <td><Form.Item name="note"><Input.TextArea aria-label="备注" maxLength={200} autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item></td>
    </>} />
    {model && !modelFailed && fields.length === 0 && <Empty description="暂无固定薪资字段" />}
  </>;
}
