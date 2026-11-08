import { useEffect, useState } from 'react';
import { App, Button, Drawer, Empty, Input, Select, Space, Spin } from 'antd';
import { fetchExpenseApproverSettings, type CustomApprovalCondition, type CustomApprovalField, type CustomApprovalNodeConfig, type ExpenseApproverEmployee } from './api';
import type { ApprovalEdge, ApprovalNode } from './customApprovalWorkflowGraph';

const FIXED_EXPENSE_OPTIONS = ['差旅费', '招待费', '办公用品', '交通费', '其他'];
const EMPTY_CONDITION: CustomApprovalCondition = { field: 'amount', operator: 'gte', value: '' };

export function CustomApprovalNodeEditor({ node, nodes, edges, fields, onCancel, onSave }: {
  node: ApprovalNode; nodes: ApprovalNode[]; edges: ApprovalEdge[]; fields: CustomApprovalField[];
  onCancel: () => void; onSave: (config: CustomApprovalNodeConfig | undefined, routes?: Record<string, CustomApprovalCondition[]>) => void;
}) {
  const { message } = App.useApp();
  const [candidates, setCandidates] = useState<ExpenseApproverEmployee[]>([]);
  const [loading, setLoading] = useState(node.data.kind === 'approver');
  const [loadError, setLoadError] = useState('');
  const [approvers, setApprovers] = useState<string[]>(node.data.config?.approverIds ?? []);
  const [outcome, setOutcome] = useState<'approved' | 'rejected'>(node.data.config?.outcome ?? 'approved');
  const outgoing = edges.filter(edge => edge.source === node.id);
  const [routes, setRoutes] = useState<Record<string, CustomApprovalCondition[]>>(() => Object.fromEntries(outgoing.map(edge => [edge.id, edge.data?.conditions?.map(item => ({ ...item })) ?? []])));
  const fieldOptions = [
    { value: 'amount', label: '报销金额（元）' }, { value: 'expenseType', label: '报销类型' },
    ...fields.filter(field => field.type === 'picker').map(field => ({ value: field.key, label: field.label })),
  ];
  const valuesFor = (field: string) => field === 'expenseType' ? FIXED_EXPENSE_OPTIONS : fields.find(item => item.key === field && item.type === 'picker')?.options ?? [];
  const updateCondition = (edgeId: string, index: number, update: Partial<CustomApprovalCondition>) => setRoutes(current => ({ ...current, [edgeId]: current[edgeId].map((item, i) => i === index ? { ...item, ...update } : item) }));
  const load = () => {
    setLoading(true); setLoadError('');
    void fetchExpenseApproverSettings().then(result => setCandidates(result.candidates)).catch((error: Error) => setLoadError(error.message || '审批人加载失败')).finally(() => setLoading(false));
  };
  useEffect(() => { if (node.data.kind === 'approver') load(); }, []);
  const names = new Map(candidates.map(item => [item.id, item.name]));
  const save = () => {
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
          if (condition.field === 'amount') {
            if (!['gte', 'lt'].includes(condition.operator) || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(condition.value)) { message.error('请输入有效的分支金额'); return; }
          } else if (condition.operator !== 'eq' || !valuesFor(condition.field).includes(condition.value)) { message.error('请选择有效的分支选项'); return; }
        }
      }
      onSave(undefined, routes); return;
    }
    onSave(node.data.kind === 'end' ? { outcome } : undefined);
  };
  const title: Record<string, string> = { start: '发起人', verify: '系统查验', approver: '审批人', branch: '条件分支', end: '结束' };
  return <Drawer title={title[node.data.kind] || '节点配置'} open onClose={onCancel} width={480} destroyOnHidden
    extra={<Space><Button onClick={onCancel}>取消</Button><Button type="primary" onClick={save} disabled={loading || !!loadError}>确定</Button></Space>}>
    {node.data.kind === 'start' && <div className="approval-config-group"><div className="approval-config-heading">发起范围</div><Input aria-label="发起范围" value="所有在职员工" disabled /></div>}
    {node.data.kind === 'verify' && <div className="approval-config-group"><div className="approval-config-heading">查验项目</div><Input aria-label="查验项目" value="发票查重与真伪查验" disabled /></div>}
    {node.data.kind === 'end' && <div className="approval-config-group"><div className="approval-config-heading">结束结果</div><Select aria-label="结束结果" value={outcome} onChange={setOutcome} options={[{ value: 'approved', label: '审批通过' }, { value: 'rejected', label: '审批驳回' }]} style={{ width: '100%' }} /></div>}
    {node.data.kind === 'approver' && <div className="approval-config-group">
      <div className="approval-config-heading">审批人（按顺序审批）</div>
      {loadError ? <Space><span>{loadError}</span><Button onClick={load}>重试</Button></Space> : <Spin spinning={loading}><Select aria-label="选择审批人" mode="multiple" showSearch optionFilterProp="label" placeholder="选择审批人" value={approvers} onChange={setApprovers} style={{ width: '100%' }} maxCount={20} options={[
        ...candidates.map(person => ({ value: person.id, label: `${person.name} · ${person.employeeNo} · ${person.jobCategory}` })),
        ...approvers.filter(id => !names.has(id)).map(id => ({ value: id, label: `${id} · 账号不可用`, disabled: true })),
      ]} /></Spin>}
      {approvers.map((id, index) => <div className="approval-approver-order" key={id}><span>{index + 1}. {names.get(id) || `${id} · 账号不可用`}</span><Space>
        <Button size="small" disabled={index === 0} onClick={() => setApprovers(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>上移</Button>
        <Button size="small" disabled={index === approvers.length - 1} onClick={() => setApprovers(current => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>下移</Button>
      </Space></div>)}
    </div>}
    {node.data.kind === 'branch' && <div className="approval-config-group">
      {!outgoing.length && <Empty description="请先连接分支目标节点" />}
      {outgoing.map((edge, routeIndex) => {
        const target = nodes.find(item => item.id === edge.target);
        const targetName = target?.data.kind === 'approver' ? '审批人' : target?.data.kind === 'end' ? '结束' : target?.data.kind === 'branch' ? '条件分支' : target?.data.kind === 'verify' ? '系统查验' : target?.data.kind === 'start' ? '发起人' : '申请表单';
        const peers = nodes.filter(item => item.data.kind === target?.data.kind);
        const targetLabel = target && peers.length > 1 ? `${targetName} ${peers.findIndex(item => item.id === target.id) + 1}` : targetName;
        return <div className="approval-branch-route" key={edge.id}>
          <div className="approval-config-heading">分支 {routeIndex + 1} → {targetLabel}</div>
          {(routes[edge.id] || []).map((condition, index) => <div className="approval-condition-row" key={index}>
            <Select aria-label={`分支${routeIndex + 1}条件${index + 1}字段`} value={condition.field} options={fieldOptions} onChange={field => updateCondition(edge.id, index, { field, operator: field === 'amount' ? 'gte' : 'eq', value: '' })} />
            <Select aria-label={`分支${routeIndex + 1}条件${index + 1}比较`} value={condition.operator} options={condition.field === 'amount' ? [{ value: 'gte', label: '大于等于' }, { value: 'lt', label: '小于' }] : [{ value: 'eq', label: '等于' }]} onChange={operator => updateCondition(edge.id, index, { operator })} />
            {condition.field === 'amount' ? <Input aria-label={`分支${routeIndex + 1}条件${index + 1}金额`} value={condition.value} onChange={event => updateCondition(edge.id, index, { value: event.target.value })} /> : <Select aria-label={`分支${routeIndex + 1}条件${index + 1}选项`} placeholder="选择选项" value={condition.value || undefined} options={valuesFor(condition.field).map(value => ({ value, label: value }))} onChange={value => updateCondition(edge.id, index, { value })} />}
            <Button type="link" danger onClick={() => setRoutes(current => ({ ...current, [edge.id]: current[edge.id].filter((_, i) => i !== index) }))}>删除</Button>
          </div>)}
          <Button size="small" onClick={() => setRoutes(current => ({ ...current, [edge.id]: [...(current[edge.id] || []), { ...EMPTY_CONDITION }] }))} disabled={(routes[edge.id] || []).length >= 20}>添加条件</Button>
        </div>;
      })}
    </div>}
  </Drawer>;
}
