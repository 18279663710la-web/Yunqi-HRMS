import { useState, type CSSProperties, type ReactNode } from 'react';
import { HolderOutlined } from '@ant-design/icons';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DraggableAttributes, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { App, Button, Card, Checkbox, Input, Modal, Select } from 'antd';
import type { CustomApprovalField, CustomApprovalType } from './api';
import { composeApprovalFormFields } from './approvalBuiltinFields';
import { normalizeExpenseOptions } from './expenseFormOptions';
import { APPROVAL_TYPE_DEFINITIONS } from './approvalTypeDefinitions';

type EditingField = Omit<CustomApprovalField, 'options'> & { options: string[] };
const FIELD_TYPES = [
  { value: 'text', label: '字符串' }, { value: 'textarea', label: '多行文字' }, { value: 'number', label: '数字' },
  { value: 'money', label: '金额' }, { value: 'date', label: '日期' }, { value: 'time', label: '时间' }, { value: 'picker', label: '单选' },
];
const RESERVED_LABELS = ['补偿方式'];

function toEditing(field: CustomApprovalField): EditingField {
  return { ...field, options: field.options?.length ? [...field.options] : field.type === 'picker' ? [''] : [] };
}

function SortableField({ id, disabled, children }: { id: string; disabled: boolean; children: (handle: { attributes: DraggableAttributes; listeners: ReturnType<typeof useSortable>['listeners'] }) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return <div ref={setNodeRef} style={style}>{children({ attributes, listeners })}</div>;
}

export function ExpenseFormDesigner({ approvalType, fields, initialized, onCancel, onSave }: {
  approvalType: CustomApprovalType;
  fields: CustomApprovalField[];
  initialized: boolean;
  onCancel: () => void;
  onSave: (fields: CustomApprovalField[]) => boolean;
}) {
  const { message } = App.useApp();
  const definition = APPROVAL_TYPE_DEFINITIONS[approvalType];
  const [items, setItems] = useState<EditingField[]>(() => composeApprovalFormFields(approvalType, fields, initialized).map(toEditing));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const update = (index: number, change: Partial<EditingField>) => setItems(current => current.map((item, i) => i === index ? { ...item, ...change } : item));
  const add = () => {
    const suffix = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID().replaceAll('-', '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    setItems(current => [...current, { key: `f${suffix.slice(0, 30)}`, label: '', type: 'text', required: false, options: [] }]);
  };
  const endDrag = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    setItems(current => {
      const from = current.findIndex(item => item.key === event.active.id);
      const to = current.findIndex(item => item.key === event.over?.id);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  };
  const save = () => {
    const names = new Set([...(definition.reservedLabels ?? []), ...RESERVED_LABELS, ...items.filter(item => item.locked).map(item => item.label)]);
    const next: CustomApprovalField[] = [];
    for (const item of items) {
      if (item.locked) { next.push({ key: item.key, label: item.label, type: 'attachment', required: item.required, locked: true }); continue; }
      const label = item.label.trim();
      if (!label || names.has(label)) { message.error('字段名称不能为空或重复'); return; }
      names.add(label);
      const options = item.type === 'picker' ? normalizeExpenseOptions(item.options) : undefined;
      if (item.type === 'picker' && !options) { message.error('单选选项不能为空、重复或超过限制'); return; }
      next.push({ key: item.key, label, type: item.type, required: item.required, ...(options ? { options } : {}) });
    }
    if (onSave(next)) onCancel();
  };
  return <Modal className="onboarding-template-editor" title={`${definition.name}表单设计`} open onCancel={onCancel} onOk={save} okText="确定" cancelText="取消" width={880} destroyOnHidden styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={endDrag}>
      <SortableContext items={items.map(item => item.key)} strategy={verticalListSortingStrategy}>
        {items.map((item, index) => <SortableField key={item.key} id={item.key} disabled={false}>{({ attributes, listeners }) => <Card className="onboarding-field-card" size="small" title={<span className="onboarding-field-heading">
          <button type="button" className="approval-drag-handle" aria-label={`拖动字段${index + 1}`} {...attributes} {...listeners}><HolderOutlined /></button>
          <span className="onboarding-field-number">{String(index + 1).padStart(2, '0')}</span>
          <span>字段 {index + 1}</span>
        </span>} extra={item.locked ? undefined : <Button onClick={() => setItems(current => current.filter((_, i) => i !== index))}>删除</Button>}>
          <div className="onboarding-field-controls">
            <label className="onboarding-field-name"><span className="approval-field-caption"><span className="form-req">*</span>字段名称</span><Input aria-label={`字段${index + 1}名称`} maxLength={100} value={item.label} disabled={item.locked} onChange={event => update(index, { label: event.target.value })} /></label>
            <label className="onboarding-field-type"><span className="approval-field-caption"><span className="form-req">*</span>字段类型</span><Select aria-label={`字段${index + 1}类型`} value={item.locked ? 'attachment' : item.type} disabled={item.locked} options={item.locked ? [{ value: 'attachment', label: '附件' }] : FIELD_TYPES} onChange={type => update(index, { type, options: type === 'picker' && !item.options.length ? ['', ''] : item.options })} /></label>
          </div>
          <Checkbox className="onboarding-field-required" checked={item.required} disabled={item.locked} onChange={event => update(index, { required: event.target.checked })}>必填</Checkbox>
          {!item.locked && item.type === 'picker' && <section className="onboarding-subfields" aria-label={`${item.label.trim() || `字段 ${index + 1}`}的选项`}>
            <div className="onboarding-subfields-heading"><span className="onboarding-subfields-marker" aria-hidden="true" /><span>{item.label.trim() || `字段 ${index + 1}`} · 选项</span></div>
            {item.options.map((option, optionIndex) => <div className="onboarding-option-row" key={optionIndex}>
              <Input className="onboarding-option-input" aria-label={`字段${index + 1}选项${optionIndex + 1}`} placeholder={`选项 ${optionIndex + 1}`} maxLength={100} value={option} onChange={event => update(index, { options: item.options.map((value, i) => i === optionIndex ? event.target.value : value) })} />
              <Button danger size="small" aria-label={`删除字段${index + 1}选项${optionIndex + 1}`} disabled={item.options.length <= 1} onClick={() => update(index, { options: item.options.filter((_, i) => i !== optionIndex) })}>删除</Button>
            </div>)}
            <Button onClick={() => update(index, { options: [...item.options, ''] })} disabled={item.options.length >= 50}>新增选项</Button>
          </section>}
        </Card>}</SortableField>)}
      </SortableContext>
    </DndContext>
    <Button onClick={add} disabled={items.length >= 40}>添加字段</Button>
  </Modal>;
}
