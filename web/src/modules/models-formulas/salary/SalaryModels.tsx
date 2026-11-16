import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { App, Button, Checkbox, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin } from 'antd';
import { HolderOutlined } from '@ant-design/icons';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ApiError } from '../../../api/client';
import { getSalaryComponentModel, saveSalaryComponentModel, type SalaryComponentModel, type SalaryModelField } from '../../hr/api';
import { SALARY_IDENTITY_FIELDS, applySalaryFieldChange, isSalaryIdentityField, moveSalaryField, orderedSalaryFields } from './salaryModel';
import { applyAttendanceInterface, clearSalaryInterface } from './salaryInterfaceConfig';
import { SubModuleHeader } from '../../../components/SubModuleHeader';

type FieldGroup = 'fixed' | 'extended';
type Editor = { mode: 'create' | 'edit'; group: FieldGroup; name?: string; identity?: boolean };

const DISPLAY_OPTIONS = [{ value: 'none', label: '无' }, { value: 'display', label: '仅显示' }, { value: 'output', label: '仅输出' }];

function SortableField({ field, fixed, selected, disabled, onSelect, onKeyDown }: {
  field: SalaryModelField;
  fixed: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.name, disabled });
  return <th ref={setNodeRef} scope="col" style={{ transform: CSS.Translate.toString(transform), transition, visibility: isDragging ? 'hidden' : undefined }}>
    <button type="button" className={`salary-field-drag${selected ? ' is-selected' : ''}`} {...attributes} {...listeners} aria-label={`${field.name}${fixed ? '，固定字段' : ''}，使用左右方向键调整顺序`} aria-pressed={selected} aria-disabled={disabled} onClick={onSelect} onKeyDown={onKeyDown}>
      <HolderOutlined aria-hidden="true" />{fixed && <span className="salary-fixed-marker" aria-hidden="true">*</span>}<span>{field.name}</span>
    </button>
  </th>;
}

export function SalaryModels() {
  const { message } = App.useApp();
  const [model, setModel] = useState<SalaryComponentModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Editor | null>(null);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const [draftMetric, setDraftMetric] = useState<SalaryModelField['attendanceMetric']>();
  const [draftRule, setDraftRule] = useState<NonNullable<SalaryModelField['calculationRule']>>('direct');
  const [interfaceError, setInterfaceError] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [orderSaving, setOrderSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const orderSavingRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [form] = Form.useForm<SalaryModelField>();
  const watchedType = Form.useWatch('type', form);
  const watchedSource = Form.useWatch('interfaceSource', form);
  const watchedMetric = Form.useWatch('attendanceMetric', form);
  const fields = orderedSalaryFields(model);
  const selected = fields.find(field => field.name === selectedName);
  const selectedGroup: FieldGroup | undefined = selected && model?.fixedFields.some(field => field.name === selected.name) ? 'fixed' : selected ? 'extended' : undefined;
  const identity = isSalaryIdentityField(selected);

  useEffect(() => {
    let active = true;
    getSalaryComponentModel().then(value => { if (active) setModel(value); }).catch((error: Error) => { if (active) { setFailed(true); message.error(error.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const openEditor = (group: FieldGroup, field?: SalaryModelField) => {
    form.resetFields();
    form.setFieldsValue(field ? { ...field, category: field.category ?? (isSalaryIdentityField(field) || field.type === 'text' || group === 'extended' ? 'info' : 'income'), interfaceSource: field.interfaceSource ?? 'none', displaySetting: field.displaySetting ?? 'none' } : { name: '', type: 'number', required: true, category: group === 'fixed' ? 'income' : 'info', interfaceSource: 'none', displaySetting: 'none' });
    setEditing({ mode: field ? 'edit' : 'create', group, name: field?.name, identity: isSalaryIdentityField(field) });
  };
  const openInterface = () => {
    const metric = form.getFieldValue('attendanceMetric');
    setDraftMetric(metric === 'overtimePay' ? 'overtimeHours' : metric);
    setDraftRule(metric === 'overtimePay' ? 'overtime' : form.getFieldValue('calculationRule') ?? 'direct');
    setInterfaceError('');
    setInterfaceOpen(true);
  };
  const save = async (values: SalaryModelField) => {
    if (!editing || !model) return;
    setSaving(true);
    try {
      const change = editing.mode === 'create' ? { action: 'create' as const, group: editing.group, field: values } : { action: 'edit' as const, group: editing.group, name: editing.name!, field: values };
      const saved = await saveSalaryComponentModel(applySalaryFieldChange(model, change));
      setModel(saved); setSelectedName(editing.identity ? editing.name! : values.name.trim()); setEditing(null); message.success(editing.mode === 'create' ? '字段已创建' : '字段已保存');
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };

  const removeSelected = async () => {
    if (!model || !selected || !selectedGroup || identity) return;
    setSaving(true);
    try {
      const saved = await saveSalaryComponentModel(applySalaryFieldChange(model, { action: 'delete', group: selectedGroup, name: selected.name }));
      setModel(saved); setSelectedName(null); message.success('字段已删除');
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };

  const saveOrder = async (nextOrder: string[]) => {
    if (!model || orderSavingRef.current || nextOrder.every((name, index) => name === fields[index]?.name)) return;
    const previous = model;
    orderSavingRef.current = true;
    setOrderSaving(true);
    setModel({ ...model, fieldOrder: nextOrder });
    try {
      const saved = await saveSalaryComponentModel({ version: model.version, fixedFields: model.fixedFields, extendedFields: model.extendedFields, fieldOrder: nextOrder });
      setModel(saved);
      message.success('字段顺序已保存');
    } catch (error) {
      setModel(previous);
      if (error instanceof ApiError && error.status === 409) {
        try { setModel(await getSalaryComponentModel()); }
        catch { message.error('模型已被修改，刷新失败，请重新打开页面'); return; }
      }
      message.error((error as Error).message);
    } finally { orderSavingRef.current = false; setOrderSaving(false); }
  };

  const startDrag = (event: DragStartEvent) => { setDragging(String(event.active.id)); };
  const endDrag = (event: DragEndEvent) => {
    setDragging(null);
    if (!event.over || event.active.id === event.over.id) return;
    const names = fields.map(field => field.name);
    const from = names.indexOf(String(event.active.id));
    const to = names.indexOf(String(event.over.id));
    if (from >= 0 && to >= 0) void saveOrder(arrayMove(names, from, to));
  };
  const moveByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const neighbour = fields[index + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (neighbour) void saveOrder(moveSalaryField(fields.map(field => field.name), fields[index].name, neighbour.name, event.key === 'ArrowLeft' ? 'before' : 'after'));
  };

  return <section className="salary-model-page" aria-label="薪资构成模型" onPointerDown={event => {
    if (!(event.target as HTMLElement).closest('.salary-model-field-list, .salary-model-entries, .salary-model-delete-confirm, .ant-modal-root')) setSelectedName(null);
  }}>
    <Spin spinning={loading}>
      <SubModuleHeader title="薪资构成模型" />
      <div className="salary-model-entries">
        <button className="salary-model-entry" type="button" disabled={loading || failed || orderSaving || saving || fields.length >= 51} onClick={() => openEditor('fixed')}>创建固定字段</button>
        <button className="salary-model-entry" type="button" disabled={loading || failed || orderSaving || saving || fields.length >= 51} onClick={() => openEditor('extended')}>创建扩展字段</button>
        <button className="salary-model-entry" type="button" disabled={!selected || !selectedGroup || orderSaving || saving} onClick={() => { if (selected && selectedGroup) openEditor(selectedGroup, selected); }}>编辑</button>
        <Popconfirm classNames={{ root: 'salary-model-delete-confirm' }} title={`删除字段“${selected?.name ?? ''}”？`} description={selectedGroup === 'fixed' ? '该字段及其已有员工定薪值会被删除。' : undefined} okText="删除" cancelText="取消" okButtonProps={{ danger: true, loading: saving }} onConfirm={() => void removeSelected()} disabled={!selected || identity || orderSaving || saving}>
          <button className="salary-model-entry salary-model-entry-danger" type="button" disabled={!selected || identity || orderSaving || saving}>删除</button>
        </Popconfirm>
      </div>
      <div ref={scrollRef} className="salary-model-scroll" role="region" aria-label="薪资模型字段" tabIndex={0}>
        {fields.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{ screenReaderInstructions: { draggable: '使用左右方向键调整顺序，也可拖动字段改变位置。' } }} onDragStart={startDrag} onDragEnd={endDrag} onDragCancel={() => setDragging(null)}>
          <SortableContext items={fields.map(field => field.name)} strategy={horizontalListSortingStrategy}>
            <table className="salary-model-field-list" aria-label="薪资模型字段列表"><thead><tr>{fields.map((field, index) => <SortableField key={field.name} field={field} fixed={!!model?.fixedFields.some(item => item.name === field.name)} selected={selectedName === field.name} disabled={orderSaving || saving} onSelect={() => setSelectedName(field.name)} onKeyDown={event => moveByKeyboard(event, index)} />)}</tr></thead></table>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {dragging && <div className="salary-drag-overlay"><HolderOutlined aria-hidden="true" />{model?.fixedFields.some(field => field.name === dragging) && <span className="salary-fixed-marker" aria-hidden="true">*</span>}<span>{dragging}</span></div>}
          </DragOverlay>
        </DndContext> : <Empty description={failed ? '加载失败' : '暂无字段'} />}
      </div>
    </Spin>
    <Modal className="onboarding-template-editor salary-model-editor" title={`${editing?.mode === 'edit' ? '编辑' : '创建'}${editing?.group === 'extended' ? '扩展' : '固定'}字段`} open={editing !== null} onCancel={() => setEditing(null)} onOk={() => form.submit()} okText="保存" cancelText="取消" confirmLoading={saving} forceRender width={700} styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}>
      <Form form={form} layout="vertical" onFinish={save}>
        <div className="salary-single-field-form">
          <Form.Item className="salary-single-field-name" name="name" label="字段名称" rules={[{ required: true, whitespace: true, message: '请输入字段名称' }, { max: 60, message: '最多 60 个字符' }, { validator: async (_, value: string | undefined) => { if (!editing?.identity && value && SALARY_IDENTITY_FIELDS.some(field => field.name === value.trim())) throw new Error('姓名、员工号和职务是固定字段'); } }]}><Input maxLength={60} disabled={editing?.identity} /></Form.Item>
          <Form.Item className="salary-single-field-required" name="required" valuePropName="checked"><Checkbox disabled={editing?.identity}>必填</Checkbox></Form.Item>
          <Form.Item name="type" label="字段类型" rules={[{ required: true }]}><Select disabled={editing?.identity || (watchedSource === 'attendance' && !!watchedMetric)} onChange={(type: 'number' | 'text') => { if (type === 'text') form.setFieldValue('category', 'info'); }} options={[{ value: 'number', label: '数字' }, { value: 'text', label: '字符串' }]} /></Form.Item>
          <Form.Item name="category" label="字段用途" rules={[{ required: true }]}><Select disabled={editing?.identity || (watchedSource === 'attendance' && !!watchedMetric)} options={[{ value: 'income', label: '收入', disabled: watchedType === 'text' }, { value: 'deduction', label: '扣款', disabled: watchedType === 'text' }, { value: 'info', label: '仅记录' }]} /></Form.Item>
          <Form.Item label="接口配置" htmlFor="interfaceSource"><Space.Compact style={{ width: '100%' }}><Form.Item name="interfaceSource" noStyle><Select disabled={editing?.identity} onChange={(source: string) => { if (source === 'attendance') { form.setFieldValue('interfaceSource', watchedSource ?? 'none'); openInterface(); } else form.setFieldsValue(clearSalaryInterface()); }} options={[{ value: 'none', label: '无' }, { value: 'attendance', label: '考勤系统' }]} /></Form.Item>{watchedSource === 'attendance' && <Button onClick={openInterface}>配置</Button>}</Space.Compact></Form.Item>
          <Form.Item name="attendanceMetric" hidden rules={[{ validator: async (_, value) => { if (form.getFieldValue('interfaceSource') === 'attendance' && !value) throw new Error('请配置考勤数据'); } }]}><Input /></Form.Item>
          <Form.Item name="calculationRule" hidden><Input /></Form.Item>
          <Form.Item name="displaySetting" label="显示设置"><Select options={DISPLAY_OPTIONS} /></Form.Item>
        </div>
      </Form>
    </Modal>
    <Modal title="考勤系统接口配置" open={interfaceOpen} onCancel={() => setInterfaceOpen(false)} onOk={() => { try { form.setFieldsValue(applyAttendanceInterface(draftMetric, draftRule)); setInterfaceOpen(false); } catch (error) { setInterfaceError((error as Error).message); } }} okText="确定" cancelText="取消" width={520}>
      <Form layout="vertical">
        <Form.Item label="考勤数据" required htmlFor="salary-attendance-metric" validateStatus={interfaceError ? 'error' : undefined} help={interfaceError || undefined}><Select id="salary-attendance-metric" value={draftMetric} onChange={value => { setDraftMetric(value); setInterfaceError(''); }} placeholder="请选择考勤数据" options={[{ value: 'presentDays', label: '实际出勤天数' }, { value: 'overtimeHours', label: '实际加班时长（小时）' }]} /></Form.Item>
        <Form.Item label="计算规则" required htmlFor="salary-calculation-rule"><Select id="salary-calculation-rule" value={draftRule} onChange={value => { setDraftRule(value); setInterfaceError(''); }} options={[{ value: 'direct', label: '直接输出' }, { value: 'attendance', label: '出勤率绩效规则' }, { value: 'overtime', label: '加班绩效规则' }]} /></Form.Item>
      </Form>
    </Modal>
  </section>;
}
