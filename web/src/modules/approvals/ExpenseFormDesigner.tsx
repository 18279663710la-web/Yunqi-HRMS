import { useState } from 'react';
import { App, Button, Input, Modal, Select, Switch, Tag } from 'antd';
import type { CustomApprovalField } from './api';

type EditingField = Omit<CustomApprovalField, 'options'> & { optionsText: string };
const FIXED_FIELDS = ['报销类型', '报销金额（元）', '费用发生日期', '费用说明', '发票附件', '补充材料'];
const FIELD_TYPES = [
  { value: 'text', label: '单行文字' }, { value: 'textarea', label: '多行文字' }, { value: 'number', label: '数字' },
  { value: 'date', label: '日期' }, { value: 'picker', label: '单选' },
];

export function ExpenseFormDesigner({ fields, onCancel, onSave }: { fields: CustomApprovalField[]; onCancel: () => void; onSave: (fields: CustomApprovalField[]) => boolean }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<EditingField[]>(() => fields.map(field => ({ ...field, optionsText: (field.options || []).join('\n') })));
  const update = (index: number, change: Partial<EditingField>) => setItems(current => current.map((item, i) => i === index ? { ...item, ...change } : item));
  const add = () => {
    const suffix = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID().replaceAll('-', '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    setItems(current => [...current, { key: `f${suffix.slice(0, 30)}`, label: '', type: 'text', required: false, optionsText: '' }]);
  };
  const save = () => {
    const names = new Set(FIXED_FIELDS);
    const next: CustomApprovalField[] = [];
    for (const item of items) {
      const label = item.label.trim();
      if (!label || names.has(label)) { message.error('字段名称不能为空或重复'); return; }
      names.add(label);
      const options = item.optionsText.split('\n').map(value => value.trim()).filter(Boolean);
      if (item.type === 'picker' && (!options.length || options.length > 50 || new Set(options).size !== options.length || options.some(option => option.length > 100))) { message.error('单选选项不能为空、重复或超过限制'); return; }
      next.push({ key: item.key, label, type: item.type, required: item.required, ...(item.type === 'picker' ? { options } : {}) });
    }
    if (onSave(next)) onCancel();
  };
  return <Modal title="报销表单设计" open onCancel={onCancel} onOk={save} okText="确定" cancelText="取消" width={760} destroyOnHidden>
    <div className="approval-form-designer">
      <div className="approval-config-heading">固定字段</div>
      <div className="approval-fixed-fields">{FIXED_FIELDS.map(field => <Tag key={field}>{field}</Tag>)}</div>
      <div className="approval-config-heading">自定义字段</div>
      {items.map((item, index) => <div className="approval-form-field" key={item.key}>
        <div className="approval-form-field-row">
          <Input aria-label={`字段${index + 1}名称`} placeholder="字段名称" maxLength={100} value={item.label} onChange={event => update(index, { label: event.target.value })} />
          <Select aria-label={`字段${index + 1}类型`} value={item.type} options={FIELD_TYPES} onChange={type => update(index, { type })} />
          <label className="approval-field-required"><Switch aria-label={`字段${index + 1}必填`} checked={item.required} onChange={required => update(index, { required })} />必填</label>
          <Button type="link" danger onClick={() => setItems(current => current.filter((_, i) => i !== index))}>删除</Button>
        </div>
        {item.type === 'picker' && <Input.TextArea aria-label={`字段${index + 1}选项`} placeholder="每行一个选项" autoSize={{ minRows: 2, maxRows: 5 }} value={item.optionsText} onChange={event => update(index, { optionsText: event.target.value })} />}
      </div>)}
      <Button onClick={add} disabled={items.length >= 30}>添加字段</Button>
    </div>
  </Modal>;
}
