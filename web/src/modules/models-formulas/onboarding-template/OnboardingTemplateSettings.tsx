import { useEffect, useState } from 'react';
import { App, Button, Card, Checkbox, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { ApiError, request } from '../../../api/client';
import { ONBOARDING_FORM_URL, type Field, type Template, type TemplateChange, type TemplateHistoryEntry } from '../../hr/onboarding/api';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { HistoryOutlined, PlusOutlined } from '@ant-design/icons';

const actionLabels = { create: '新建', update: '修改', delete: '删除' } as const;
const actionColors = { create: '#80BB9E', update: '#8BA6C1', delete: '#C97474' } as const;
const fieldTypeLabels = { text: '字符串', number: '数字', date: '日期', select: '单选', attachment: '附件', table: '表格' } as const;

const cloneFields = (fields: Field[]): Field[] => JSON.parse(JSON.stringify(fields)) as Field[];
const formatTemplateChange = (change: TemplateChange): string => `${change.label}：${change.before === undefined ? '—' : String(change.before)} → ${change.after === undefined ? '—' : String(change.after)}`;
const templateSummary = (entry: TemplateHistoryEntry): string => {
  const snapshot = entry.action === 'delete' ? entry.before : entry.after;
  return snapshot ? `模板名称：${snapshot.name}；字段数量：${snapshot.fields.length}` : '—';
};
const templateFieldsText = (entry: TemplateHistoryEntry): string => {
  const snapshot = entry.action === 'delete' ? entry.before : entry.after;
  if (!snapshot) return '';
  return snapshot.fields.map(field => `${field.name}（${fieldTypeLabels[field.type]}${field.type === 'select' ? `：${field.options?.join('/') ?? ''}` : ''}${field.type === 'table' ? ` / ${field.children?.length ?? 0} 个子字段` : ''}）`).join('、');
};

export function OnboardingTemplateSettings() {
  const { message, modal } = App.useApp();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [edit, setEdit] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingVersion, setEditingVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [templateHistoryOpen, setTemplateHistoryOpen] = useState(false);
  const [templateHistory, setTemplateHistory] = useState<TemplateHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [templateForm] = Form.useForm<{ name: string; fields: Field[] }>();

  const loadTemplates = async () => {
    try { setTemplates(await request<Template[]>(`${ONBOARDING_FORM_URL}/templates`)); }
    catch (error) { message.error((error as Error).message); }
  };
  useEffect(() => { void loadTemplates(); }, []);

  const clean = (field: Field): Record<string, unknown> => Object.fromEntries(Object.entries({ ...field, options: field.type === 'select' ? field.options : undefined, children: field.type === 'table' ? field.children?.map(clean) : undefined }).filter(([, value]) => value !== null && value !== undefined));
  const save = async (values: { name: string; fields: Field[] }) => {
    if (!values.fields?.length) { message.warning('请至少添加一个字段'); return; }
    setSaving(true);
    try {
      const body = { name: values.name.trim(), fields: values.fields.map(clean) };
      if (editingId === null) await request(`${ONBOARDING_FORM_URL}/templates`, { method: 'POST', body });
      else await request(`${ONBOARDING_FORM_URL}/templates/${editingId}`, { method: 'PUT', body: { ...body, version: editingVersion } });
      setEdit(false); await loadTemplates(); message.success(editingId === null ? '模板已新建' : '模板已保存');
    } catch (error) {
      message.error((error as Error).message);
      if (error instanceof ApiError && error.status === 409) { setEdit(false); await loadTemplates(); }
    } finally { setSaving(false); }
  };
  const setDefault = async (id: number) => {
    if (saving || templates.some(t => t.id === id && t.isDefault)) return;
    setSaving(true); try { await request(`${ONBOARDING_FORM_URL}/templates/${id}/default`, { method: 'PUT', body: {} }); setTemplates(current => current.map(t => ({ ...t, isDefault: t.id === id }))); message.success('现用模板已更新'); }
    catch (error) { message.error((error as Error).message); } finally { setSaving(false); }
  };
  const openCreate = () => { templateForm.resetFields(); templateForm.setFieldsValue({ name: '', fields: [] }); setEditingId(null); setEditingVersion(0); setEdit(true); };
  const openEdit = (template: Template) => { templateForm.resetFields(); templateForm.setFieldsValue({ name: template.name, fields: cloneFields(template.fields) }); setEditingId(template.id); setEditingVersion(template.version); setEdit(true); };
  const editingTemplate = editingId === null ? undefined : templates.find(t => t.id === editingId);
  const deleteDisabled = !editingTemplate || editingTemplate.isDefault || templates.length <= 1;
  const deleteHint = !editingTemplate ? '' : editingTemplate.isDefault ? '现用模板不能删除，请先切换现用模板' : templates.length <= 1 ? '至少保留一个入职申请表模板' : '';
  const exportTemplate = async () => {
    let values: { name: string; fields: Field[] };
    try { values = await templateForm.validateFields(); }
    catch { message.warning('请先完善模板字段后再导出'); return; }
    if (!values.fields?.length) { message.warning('请至少添加一个字段'); return; }
    try {
      const { downloadOnboardingWorkbook } = await import('./onboardingExcel');
      await downloadOnboardingWorkbook(values.name.trim(), values.fields);
      message.success('入职申请表已导出');
    } catch { message.error('导出失败，请稍后重试'); }
  };
  const deleteTemplate = () => {
    if (!editingTemplate) return;
    modal.confirm({
      title: `删除模板“${editingTemplate.name}”？`,
      content: '删除后不可恢复。已登记或已提交的入职申请使用登记时的字段快照，不受影响。',
      okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: async () => {
        try { await request(`${ONBOARDING_FORM_URL}/templates/${editingTemplate.id}`, { method: 'DELETE' }); setEdit(false); await loadTemplates(); message.success('模板已删除'); }
        catch (error) { message.error((error as Error).message); throw error; }
      },
    });
  };
  const loadTemplateHistory = async () => {
    setTemplateHistoryOpen(true); setHistoryLoading(true);
    try { setTemplateHistory(await request<TemplateHistoryEntry[]>(`${ONBOARDING_FORM_URL}/template-history`)); }
    catch (error) { message.error((error as Error).message); }
    finally { setHistoryLoading(false); }
  };

  return <div>
    <SubModuleHeader title="入职申请表设置" />
    <div className="filter-bar" role="toolbar" aria-label="入职申请表设置操作">
      <Tooltip title="修改历史" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="修改历史" icon={<HistoryOutlined />} onClick={() => void loadTemplateHistory()} />
      </Tooltip>
      <Tooltip title="新建模板" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="新建模板" icon={<PlusOutlined />} onClick={openCreate} />
      </Tooltip>
    </div>
    <div className="module-list-card">
      <Table<Template>
        rowKey="id"
        size="small"
        columns={[
          { title: '模板名称', dataIndex: 'name' },
          { title: '字段数量', render: (_, t) => `${t.fields.length} 个字段` },
          { title: '状态', render: (_, t) => (t.isDefault ? <Tag color="#F5F5F5">现用</Tag> : <Typography.Text type="secondary">—</Typography.Text>) },
          {
            title: '操作',
            width: 180,
            render: (_, t) => <Space size={4}>
              <Button type="link" size="small" aria-label={`编辑模板${t.id}`} disabled={saving} onClick={() => openEdit(t)}>编辑</Button>
              <Button type="link" size="small" aria-label={`设为现用${t.id}`} disabled={saving || t.isDefault} onClick={() => void setDefault(t.id)}>设为现用</Button>
            </Space>,
          },
        ]}
        dataSource={templates}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: '暂无模板' }}
      />
    </div>
    <Modal className="onboarding-template-editor" title={editingId === null ? '新建入职申请表模板' : `编辑模板：${editingTemplate?.name ?? ''}`} open={edit} onCancel={() => setEdit(false)} width={800} destroyOnHidden styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}
      footer={<div className="onboarding-modal-footer">
        {editingId === null ? <span /> : <Space><Tooltip title={deleteHint}><span><Button danger disabled={deleteDisabled} onClick={deleteTemplate}>删除模板</Button></span></Tooltip><Button onClick={() => void exportTemplate()}>导出模板</Button></Space>}
        <Space><Button onClick={() => setEdit(false)}>取消</Button><Button type="primary" loading={saving} onClick={() => templateForm.submit()}>保存</Button></Space>
      </div>}>
      <Form form={templateForm} layout="vertical" onFinish={save}>
        <Form.Item name="name" label="模板名称" rules={[{ required: true, whitespace: true, message: '请填写模板名称' }, { max: 50, message: '模板名称不能超过 50 个字符' }]}><Input maxLength={50} placeholder="例如：标准入职申请表" /></Form.Item>
        <Form.List name="fields">{(fields, { add, remove }) => <>
          {fields.map(({ key, name, ...rest }) => <Card className="onboarding-field-card" size="small" key={key} title={<span className="onboarding-field-heading"><span className="onboarding-field-number">{String(name + 1).padStart(2, '0')}</span><span>字段 {name + 1}</span></span>} extra={<Button onClick={() => remove(name)}>删除</Button>}>
            <div className="onboarding-field-controls"><Form.Item className="onboarding-field-name" {...rest} label="字段名称" name={[name, 'name']} rules={[{ required: true, whitespace: true }]}><Input maxLength={30} /></Form.Item>
              <Form.Item className="onboarding-field-type" {...rest} label="字段类型" name={[name, 'type']} rules={[{ required: true }]}><Select options={[{ value: 'text', label: '字符串' }, { value: 'number', label: '数字' }, { value: 'date', label: '日期' }, { value: 'select', label: '单选' }, { value: 'attachment', label: '附件' }, { value: 'table', label: '表格' }]} onChange={(value) => { if (value === 'select' && !templateForm.getFieldValue(['fields', name, 'options'])?.length) templateForm.setFieldValue(['fields', name, 'options'], ['选项1', '选项2']); }} /></Form.Item>
              <Form.Item noStyle shouldUpdate>{() => { const type = templateForm.getFieldValue(['fields', name, 'type']); return type === 'text' ? <Form.Item className="onboarding-field-limit" {...rest} label="最大字符数" name={[name, 'maxLength']}><InputNumber min={1} max={500} precision={0} /></Form.Item> : type === 'number' ? <><Form.Item className="onboarding-field-limit" {...rest} label="最小值" name={[name, 'min']}><InputNumber /></Form.Item><Form.Item className="onboarding-field-limit" {...rest} label="最大值" name={[name, 'max']}><InputNumber /></Form.Item></> : null; }}</Form.Item>
            </div>
            <Form.Item className="onboarding-field-required" {...rest} name={[name, 'required']} valuePropName="checked"><Checkbox>必填</Checkbox></Form.Item>
            <Form.Item noStyle shouldUpdate>{() => templateForm.getFieldValue(['fields', name, 'type']) === 'select' && <section className="onboarding-subfields" aria-label={`${templateForm.getFieldValue(['fields', name, 'name']) || `字段 ${name + 1}`}的选项`}>
              <div className="onboarding-subfields-heading"><span className="onboarding-subfields-marker" aria-hidden="true" /><span>{templateForm.getFieldValue(['fields', name, 'name']) || `字段 ${name + 1}`} · 选项</span></div>
              <Form.List name={[name, 'options']}>{(options, { add: addOption, remove: removeOption }) => <>
                {options.map(({ key: optionKey, name: optionName, ...optionRest }) => <div className="onboarding-option-row" key={optionKey}>
                  <Form.Item {...optionRest} className="onboarding-option-input" name={[optionName]} rules={[{ required: true, whitespace: true, message: '请填写选项' }, { max: 50, message: '选项不能超过 50 个字符' }]}><Input maxLength={50} placeholder={`选项 ${optionName + 1}`} /></Form.Item>
                  <Button danger size="small" onClick={() => removeOption(optionName)} disabled={options.length <= 1}>删除</Button>
                </div>)}
                <Button onClick={() => addOption('')} disabled={options.length >= 30}>新增选项</Button>
              </>}</Form.List>
            </section>}</Form.Item>
            <Form.Item noStyle shouldUpdate>{() => templateForm.getFieldValue(['fields', name, 'type']) === 'table' && <section className="onboarding-subfields" aria-label={`${templateForm.getFieldValue(['fields', name, 'name']) || `字段 ${name + 1}`}的子字段`}>
              <div className="onboarding-subfields-heading"><span className="onboarding-subfields-marker" aria-hidden="true" /><span>{templateForm.getFieldValue(['fields', name, 'name']) || `字段 ${name + 1}`} · 子字段</span></div>
              <Form.List name={[name, 'children']}>{(children, { add: addChild, remove: removeChild }) => <>
                {children.map(({ key: childKey, name: childName, ...childRest }) => <Card className="onboarding-subfield-card" key={childKey} size="small" title={`子字段 ${childName + 1}`} extra={<Button onClick={() => removeChild(childName)}>删除子字段</Button>}>
                  <div className="onboarding-field-controls"><Form.Item className="onboarding-field-name" {...childRest} name={[childName, 'name']} label="子字段名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={30} /></Form.Item>
                    <Form.Item className="onboarding-field-type" {...childRest} name={[childName, 'type']} label="类型" rules={[{ required: true }]}><Select options={[{ value: 'text', label: '字符串' }, { value: 'number', label: '数字' }, { value: 'date', label: '日期' }, { value: 'select', label: '单选' }, { value: 'attachment', label: '附件' }]} onChange={(value) => { if (value === 'select' && !templateForm.getFieldValue(['fields', name, 'children', childName, 'options'])?.length) templateForm.setFieldValue(['fields', name, 'children', childName, 'options'], ['选项1', '选项2']); }} /></Form.Item>
                    <Form.Item noStyle shouldUpdate>{() => { const type = templateForm.getFieldValue(['fields', name, 'children', childName, 'type']); return type === 'text' ? <Form.Item className="onboarding-field-limit" {...childRest} label="最大字符数" name={[childName, 'maxLength']}><InputNumber min={1} max={500} precision={0} /></Form.Item> : type === 'number' ? <><Form.Item className="onboarding-field-limit" {...childRest} label="最小值" name={[childName, 'min']}><InputNumber /></Form.Item><Form.Item className="onboarding-field-limit" {...childRest} label="最大值" name={[childName, 'max']}><InputNumber /></Form.Item></> : null; }}</Form.Item>
                  </div>
                  <Form.Item className="onboarding-field-required" {...childRest} name={[childName, 'required']} valuePropName="checked"><Checkbox>必填</Checkbox></Form.Item>
                  <Form.Item noStyle shouldUpdate>{() => templateForm.getFieldValue(['fields', name, 'children', childName, 'type']) === 'select' && <section className="onboarding-subfields" aria-label={`${templateForm.getFieldValue(['fields', name, 'children', childName, 'name']) || `子字段 ${childName + 1}`}的选项`}>
                    <div className="onboarding-subfields-heading"><span className="onboarding-subfields-marker" aria-hidden="true" /><span>{templateForm.getFieldValue(['fields', name, 'children', childName, 'name']) || `子字段 ${childName + 1}`} · 选项</span></div>
                    <Form.List name={[childName, 'options']}>{(options, { add: addOption, remove: removeOption }) => <>
                      {options.map(({ key: optionKey, name: optionName, ...optionRest }) => <div className="onboarding-option-row" key={optionKey}>
                        <Form.Item {...optionRest} className="onboarding-option-input" name={[optionName]} rules={[{ required: true, whitespace: true, message: '请填写选项' }, { max: 50, message: '选项不能超过 50 个字符' }]}><Input maxLength={50} placeholder={`选项 ${optionName + 1}`} /></Form.Item>
                        <Button danger size="small" onClick={() => removeOption(optionName)} disabled={options.length <= 1}>删除</Button>
                      </div>)}
                      <Button onClick={() => addOption('')} disabled={options.length >= 30}>新增选项</Button>
                    </>}</Form.List>
                  </section>}</Form.Item>
                </Card>)}<Button onClick={() => addChild({ name: '', type: 'text', required: true })} disabled={children.length >= 30}>创建子字段</Button>
              </>}</Form.List></section>}</Form.Item>
          </Card>)}<Button onClick={() => add({ name: '', type: 'text', required: true })} disabled={fields.length >= 30}>新增字段</Button>
        </>}</Form.List>
      </Form>
    </Modal>
    <Modal title="模板修改历史" open={templateHistoryOpen} onCancel={() => setTemplateHistoryOpen(false)} footer={<Button onClick={() => setTemplateHistoryOpen(false)}>关闭</Button>} width={820} styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}>
      <Spin spinning={historyLoading}>
        {templateHistory.length === 0 ? <Empty description="暂无模板修改记录" /> : <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {templateHistory.map(entry => <Card key={entry.id} size="small" title={<Space><span>{entry.templateName}</span><Tag color={actionColors[entry.action]}>{actionLabels[entry.action]}</Tag></Space>} extra={<Typography.Text type="secondary">{dayjs(entry.createdAt).format('YYYY-MM-DD HH:mm:ss')} · {entry.adminName}</Typography.Text>}>
            {entry.changes.length > 0 ? <Space direction="vertical" size={4}>{entry.changes.map((change, index) => <div className="onboarding-history-change" key={index}>{formatTemplateChange(change)}</div>)}</Space> : <><Typography.Text type="secondary">{templateSummary(entry)}</Typography.Text><div className="onboarding-history-fields">{templateFieldsText(entry)}</div></>}
          </Card>)}
        </Space>}
      </Spin>
    </Modal>
  </div>;
}
