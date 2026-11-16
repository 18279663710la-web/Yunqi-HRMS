import { useState } from 'react';
import { App, Button, Input, Modal, Select, Space } from 'antd';
import { createWorkflowTestCase, reconcileWorkflowCases, withDerivedTestValues } from './workflowTestCases';
import { saveWorkflowTestCases, type CustomApprovalType, type WorkflowTestCasesDocument, type WorkflowTestField } from './api';

export function ApprovalTestCases({ approvalType, fields, document, onCancel, onSaved }: {
  approvalType: string;
  fields: WorkflowTestField[];
  document: WorkflowTestCasesDocument;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [items, setItems] = useState(() => reconcileWorkflowCases(document.cases, fields).map(item => ({ ...item, values: withDerivedTestValues(approvalType, item.values) })));
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const active = items[selected];
  const update = (change: Partial<typeof active>) => setItems(current => current.map((item, index) => index === selected ? { ...item, ...change } : item));
  const updateValue = (key: string, value: string) => update({ values: withDerivedTestValues(approvalType, { ...active.values, [key]: value }) });
  const save = async () => {
    if (items.some(item => !item.name.trim())) { message.error('请填写测试用例名称'); return; }
    setSaving(true);
    try {
      await saveWorkflowTestCases(approvalType, { version: document.version, cases: items.map(item => ({ ...item, name: item.name.trim() })) });
      message.success('测试用例已保存');
      onSaved();
    } catch (error) { message.error((error as Error).message || '保存失败'); }
    finally { setSaving(false); }
  };
  return <Modal title="测试用例" open centered width={800} closable={!saving} keyboard={!saving} maskClosable={!saving} cancelButtonProps={{ disabled: saving }} onCancel={() => { if (!saving) onCancel(); }} onOk={() => void save()} okText="保存" cancelText="取消" confirmLoading={saving} destroyOnHidden>
    <div className="approval-test-cases">
      <div className="approval-test-case-toolbar">
        <Select aria-label="选择测试用例" value={selected} onChange={setSelected} options={items.map((item, index) => ({ value: index, label: item.name || `用例 ${index + 1}` }))} />
        <Space><Button disabled={items.length >= 50} onClick={() => { setItems(current => { const item = createWorkflowTestCase(fields, current.length + 1); return [...current, { ...item, values: withDerivedTestValues(approvalType, item.values) }]; }); setSelected(items.length); }}>新增</Button>
          <Button danger disabled={items.length <= 1} onClick={() => { setItems(current => current.filter((_, index) => index !== selected)); setSelected(0); }}>删除</Button></Space>
      </div>
      <label className="approval-test-field approval-test-name"><span>用例名称</span><Input value={active.name} maxLength={100} onChange={event => update({ name: event.target.value })} /></label>
      <div className="approval-test-fields">{fields.map(field => <label className="approval-test-field" key={field.key}>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        {field.type === 'picker' ? <Select aria-label={field.label} value={active.values[field.key] || undefined} options={(field.options ?? []).map(value => ({ value, label: value }))} onChange={value => updateValue(field.key, value)} />
          : field.type === 'textarea' ? <Input.TextArea aria-label={field.label} value={active.values[field.key] ?? ''} maxLength={field.maxlength || 200} autoSize={{ minRows: 1, maxRows: 4 }} onChange={event => updateValue(field.key, event.target.value)} />
            : <Input aria-label={field.label} type={field.type === 'date' || field.type === 'time' ? field.type : 'text'} readOnly={approvalType === 'leave' && field.key === 'days'} value={active.values[field.key] ?? ''} maxLength={field.maxlength || (field.type === 'text' ? 140 : 2000)} onChange={event => updateValue(field.key, event.target.value)} />}
      </label>)}</div>
    </div>
  </Modal>;
}
