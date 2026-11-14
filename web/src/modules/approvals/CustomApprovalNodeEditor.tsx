import { useEffect, useState } from 'react';
import { App, Button, Empty, Input, Modal, Select, Space, Spin } from 'antd';
import { getCustomWorkflowApproverCandidates, type CustomApprovalCondition, type CustomApprovalField, type CustomApprovalNodeConfig, type CustomApprovalType, type ExpenseApproverEmployee } from './api';
import type { ApprovalEdge, ApprovalNode } from './customApprovalWorkflowGraph';
import { APPROVAL_TYPE_DEFINITIONS } from './approvalTypeDefinitions';

export function CustomApprovalNodeEditor({ approvalType, node, nodes, edges, fields, hasPendingApiKey, onCancel, onSave }: {
  approvalType: CustomApprovalType;
  node: ApprovalNode; nodes: ApprovalNode[]; edges: ApprovalEdge[]; fields: CustomApprovalField[];
  hasPendingApiKey?: boolean;
  onCancel: () => void; onSave: (config: CustomApprovalNodeConfig | undefined, routes?: Record<string, CustomApprovalCondition[]>, apiKey?: string) => void;
}) {
  const { message } = App.useApp();
  const [candidates, setCandidates] = useState<ExpenseApproverEmployee[]>([]);
  const [loading, setLoading] = useState(node.data.kind === 'approver');
  const [loadError, setLoadError] = useState('');
  const [approvers, setApprovers] = useState<string[]>(node.data.config?.approverIds ?? []);
  const [approverListOpen, setApproverListOpen] = useState(false);
  const [outcome, setOutcome] = useState<'approved' | 'rejected'>(node.data.config?.outcome ?? 'approved');
  const [provider, setProvider] = useState<'deepseek' | 'openai-compatible'>(node.data.config?.provider ?? 'deepseek');
  const [model, setModel] = useState(node.data.config?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(node.data.config?.baseUrl ?? 'https://api.deepseek.com');
  const [rules, setRules] = useState(node.data.config?.rules ?? '');
  const [apiKey, setApiKey] = useState('');
  const outgoing = edges.filter(edge => edge.source === node.id);
  const [routes, setRoutes] = useState<Record<string, CustomApprovalCondition[]>>(() => Object.fromEntries(outgoing.map(edge => [edge.id, edge.data?.conditions?.map(item => ({ ...item })) ?? []])));
  const definition = APPROVAL_TYPE_DEFINITIONS[approvalType];
  const numericField = definition.numericCondition?.value;
  const known = new Set([...(numericField ? [numericField] : []), ...definition.choices.map(choice => choice.value)]);
  const fieldOptions = [
    ...(definition.numericCondition ? [{ value: definition.numericCondition.value, label: fields.find(field => field.key === definition.numericCondition?.value)?.label || definition.numericCondition.label }] : []),
    ...definition.choices.map(choice => ({ value: choice.value, label: fields.find(field => field.key === choice.value)?.label || choice.label })),
    ...fields.filter(field => field.type === 'picker' && !known.has(field.key)).map(field => ({ value: field.key, label: field.label })),
  ];
  const valuesFor = (field: string) => fields.find(item => item.key === field && item.type === 'picker')?.options ?? definition.choices.find(item => item.value === field)?.options ?? [];
  const updateCondition = (edgeId: string, index: number, update: Partial<CustomApprovalCondition>) => setRoutes(current => ({ ...current, [edgeId]: current[edgeId].map((item, i) => i === index ? { ...item, ...update } : item) }));
  const load = () => {
    setLoading(true); setLoadError('');
    void getCustomWorkflowApproverCandidates(approvalType).then(result => setCandidates(result.candidates)).catch((error: Error) => setLoadError(error.message || '审批人加载失败')).finally(() => setLoading(false));
  };
  useEffect(() => { if (node.data.kind === 'approver') load(); }, []);
  const names = new Map(candidates.map(item => [item.id, item.name]));
  const save = () => {
    if (node.data.kind === 'ai') {
      if (!model.trim() || !rules.trim()) { message.error('请填写模型名称和审批规则'); return; }
      try { const url = new URL(baseUrl.trim()); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(); }
      catch { message.error('请输入有效的模型接口地址'); return; }
      if (!apiKey.trim() && !hasPendingApiKey && !node.data.config?.hasApiKey) { message.error('请填写 API Key'); return; }
      onSave({ provider, model: model.trim(), baseUrl: baseUrl.trim(), rules, hasApiKey: node.data.config?.hasApiKey ?? false }, undefined, apiKey.trim() || undefined); return;
    }
    if (node.data.kind === 'approver') {
      if (loading || loadError) return;
      if (!approvers.length || new Set(approvers).size !== approvers.length) { message.error('请选择审批人'); return; }
      onSave({ approverIds: approvers }); return;
    }
    if (node.data.kind === 'branch') {
      for (const edge of outgoing) {
        const conditions = routes[edge.id] || [];
        if (!conditions.length) { message.error('请为每条分支设置条件'); return; }
        for (const condition of conditions) {
          if (condition.field === numericField) {
            if (!['gte', 'lt'].includes(condition.operator) || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(condition.value)) { message.error('请输入有效的分支数值'); return; }
          } else if (condition.operator !== 'eq' || !valuesFor(condition.field).includes(condition.value)) { message.error('请选择有效的分支选项'); return; }
        }
      }
      onSave(undefined, routes); return;
    }
    onSave(node.data.kind === 'end' ? { outcome } : undefined);
  };
  const title: Record<string, string> = { start: '发起人', verify: '系统查验', ai: 'AI 审批', approver: '审批人', branch: '条件分支', end: '结束' };
  return <Modal title={title[node.data.kind] || '节点配置'} open centered onCancel={onCancel} onOk={save} okText="确定" cancelText="取消" width={760} destroyOnHidden
    className="approval-node-modal" wrapClassName="approval-node-modal-wrap" okButtonProps={{ disabled: loading || !!loadError }}>
    {node.data.kind === 'start' && <div className="approval-config-group"><div className="approval-config-heading">发起范围</div><Input aria-label="发起范围" value="所有在职员工" disabled /></div>}
    {node.data.kind === 'verify' && <div className="approval-config-group"><div className="approval-config-heading">查验项目</div><Input aria-label="查验项目" value="发票查重与真伪查验" disabled /></div>}
    {node.data.kind === 'ai' && <div className="approval-ai-form">
      <label className="approval-ai-field"><span>模型服务</span><Select aria-label="模型服务" value={provider} onChange={value => { setProvider(value); setBaseUrl(value === 'deepseek' ? 'https://api.deepseek.com' : ''); }} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'openai-compatible', label: 'OpenAI 兼容接口' }]} /></label>
      <label className="approval-ai-field"><span>模型名称</span><Input aria-label="模型名称" value={model} maxLength={150} placeholder="输入模型名称" onChange={event => setModel(event.target.value)} /></label>
      <label className="approval-ai-field approval-ai-field-wide"><span>接口地址</span><Input aria-label="接口地址" value={baseUrl} maxLength={500} placeholder="输入接口地址" onChange={event => setBaseUrl(event.target.value)} /></label>
      <label className="approval-ai-field approval-ai-field-wide"><span>API Key</span><Input.Password aria-label="API Key" autoComplete="new-password" value={apiKey} maxLength={2048} placeholder={hasPendingApiKey ? '已填写，保存流程后生效' : node.data.config?.hasApiKey ? '已配置，留空保留原密钥' : '输入 API Key'} onChange={event => setApiKey(event.target.value)} /></label>
      <label className="approval-ai-field approval-ai-field-wide"><span>审批规则</span><Input.TextArea aria-label="审批规则" value={rules} maxLength={10000} autoSize={{ minRows: 5, maxRows: 10 }} placeholder="输入审批规则" onChange={event => setRules(event.target.value)} /></label>
    </div>}
    {node.data.kind === 'end' && <div className="approval-config-group"><div className="approval-config-heading">结束结果</div><Select aria-label="结束结果" value={outcome} onChange={setOutcome} options={[{ value: 'approved', label: '审批通过' }, { value: 'rejected', label: '审批驳回' }]} style={{ width: '100%' }} /></div>}
    {node.data.kind === 'approver' && <div className="approval-config-group">
      <div className="approval-config-heading">审批人（按顺序审批）</div>
      {loadError ? <Space><span>{loadError}</span><Button onClick={load}>重试</Button></Space> : <div className="approval-approver-select-anchor"><Spin spinning={loading}><Select aria-label="选择审批人" mode="multiple" showSearch optionFilterProp="label" placeholder="选择审批人" value={approvers} onChange={setApprovers} onOpenChange={setApproverListOpen} getPopupContainer={trigger => trigger.closest('.approval-approver-select-anchor') as HTMLElement} popupClassName="approval-approver-dropdown" listHeight={192} style={{ width: '100%' }} maxCount={20} options={[
        ...candidates.map(person => ({ value: person.id, label: [person.name, person.employeeNo || '小程序账号', person.jobCategory === person.name ? '' : person.jobCategory].filter(Boolean).join(' · ') })),
        ...approvers.filter(id => !names.has(id)).map(id => ({ value: id, label: `${id} · 账号不可用`, disabled: true })),
      ]} /></Spin>{approverListOpen && <div className="approval-approver-dropdown-space" aria-hidden="true" />}</div>}
      {approvers.map((id, index) => <div className="approval-approver-order" key={id}><span>{index + 1}. {names.get(id) || `${id} · 账号不可用`}</span><Space>
        <Button size="small" disabled={index === 0} onClick={() => setApprovers(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>上移</Button>
        <Button size="small" disabled={index === approvers.length - 1} onClick={() => setApprovers(current => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>下移</Button>
      </Space></div>)}
    </div>}
    {node.data.kind === 'branch' && <div className="approval-config-group">
      {!outgoing.length && <Empty description="请先连接分支目标节点" />}
      {outgoing.map((edge, routeIndex) => {
        const target = nodes.find(item => item.id === edge.target);
        const targetName = target?.data.kind === 'approver' ? '审批人' : target?.data.kind === 'end' ? '结束' : target?.data.kind === 'branch' ? '条件分支' : target?.data.kind === 'verify' ? '系统查验' : target?.data.kind === 'ai' ? 'AI 审批' : target?.data.kind === 'start' ? '发起人' : '申请表单';
        const peers = nodes.filter(item => item.data.kind === target?.data.kind);
        const targetLabel = target && peers.length > 1 ? `${targetName} ${peers.findIndex(item => item.id === target.id) + 1}` : targetName;
        return <div className="approval-branch-route" key={edge.id}>
          <div className="onboarding-subfields-heading"><span className="onboarding-subfields-marker" />分支 {routeIndex + 1} → {targetLabel}</div>
          {!fieldOptions.length && <span>请先在表单设计中添加单选字段</span>}
          {(routes[edge.id] || []).map((condition, index) => <div className="approval-condition-row" key={index}>
            <div className="approval-node-field"><div className="approval-node-field-label">字段</div><Select aria-label={`分支${routeIndex + 1}条件${index + 1}字段`} value={condition.field} options={fieldOptions} onChange={field => updateCondition(edge.id, index, { field, operator: field === numericField ? 'gte' : 'eq', value: '' })} /></div>
            <div className="approval-node-field"><div className="approval-node-field-label">比较方式</div><Select aria-label={`分支${routeIndex + 1}条件${index + 1}比较`} value={condition.operator} options={condition.field === numericField ? [{ value: 'gte', label: '大于等于' }, { value: 'lt', label: '小于' }] : [{ value: 'eq', label: '等于' }]} onChange={operator => updateCondition(edge.id, index, { operator })} /></div>
            <div className="approval-node-field"><div className="approval-node-field-label">条件值</div>{condition.field === numericField ? <Input aria-label={`分支${routeIndex + 1}条件${index + 1}数值`} value={condition.value} onChange={event => updateCondition(edge.id, index, { value: event.target.value })} /> : <Select aria-label={`分支${routeIndex + 1}条件${index + 1}选项`} placeholder="选择选项" value={condition.value || undefined} options={valuesFor(condition.field).map(value => ({ value, label: value }))} onChange={value => updateCondition(edge.id, index, { value })} />}</div>
            <Button type="link" danger onClick={() => setRoutes(current => ({ ...current, [edge.id]: current[edge.id].filter((_, i) => i !== index) }))}>删除</Button>
          </div>)}
          <Button onClick={() => setRoutes(current => ({ ...current, [edge.id]: [...(current[edge.id] || []), { field: fieldOptions[0].value, operator: fieldOptions[0].value === numericField ? 'gte' : 'eq', value: '' }] }))} disabled={!fieldOptions.length || (routes[edge.id] || []).length >= 20}>添加条件</Button>
        </div>;
      })}
    </div>}
  </Modal>;
}
