import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DragOutlined, PlusOutlined, SelectOutlined } from '@ant-design/icons';
import { Alert, App, Button } from 'antd';
import { ReactFlowProvider, applyEdgeChanges, applyNodeChanges, type OnConnect, type OnEdgesChange, type OnNodesChange } from '@xyflow/react';
import { APPROVAL_NODE_PRESETS, CustomApprovalCanvas } from './CustomApprovalCanvas';
import { ExpenseFormDesigner } from './ExpenseFormDesigner';
import { CustomApprovalNodeEditor } from './CustomApprovalNodeEditor';
import { canConnectApprovalNodes, createApprovalEdge, createApprovalNode, serializeApprovalWorkflow, type ApprovalEdge, type ApprovalNode } from './customApprovalWorkflowGraph';
import { getCustomApprovalWorkflow, saveCustomApprovalWorkflow, type CustomApprovalField, type CustomApprovalNodeKind, type CustomApprovalType, type CustomApprovalWorkflow as WorkflowDocument } from './api';
import { APPROVAL_TYPE_DEFINITIONS, isNodeAvailable } from './approvalTypeDefinitions';

interface Draft { version: number; nodes: ApprovalNode[]; edges: ApprovalEdge[]; formFields: CustomApprovalField[]; saved: string; pendingApiKeys: Record<string, string> }
function fromDocument(document: WorkflowDocument): Draft {
  const formFields = document.formFields ?? [];
  const nodes: ApprovalNode[] = document.nodes.map(node => ({ id: node.id, type: 'approval', position: node.position, data: { kind: node.kind, ...(node.config ? { config: node.config } : {}) } }));
  const edges: ApprovalEdge[] = document.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'default', ...(edge.conditions ? { data: { conditions: edge.conditions } } : {}) }));
  return { version: document.version, nodes, edges, formFields, saved: JSON.stringify(serializeApprovalWorkflow(document.version, nodes, edges, formFields)), pendingApiKeys: {} };
}

export function CustomApprovalWorkflow({ approvalType, toolbarExtra }: { approvalType: CustomApprovalType; toolbarExtra?: ReactNode }) {
  const { message, modal } = App.useApp();
  const [mounted, setMounted] = useState(false);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [drafts, setDrafts] = useState<Partial<Record<CustomApprovalType, Draft>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [addRequest, setAddRequest] = useState<{ kind: CustomApprovalNodeKind; id: number } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [configNodeId, setConfigNodeId] = useState<string | null>(null);
  const nextAdd = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const draft = drafts[approvalType];

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (drafts[approvalType]) { setLoading(false); setLoadError(''); return; }
    let active = true;
    setLoading(true); setLoadError('');
    getCustomApprovalWorkflow(approvalType).then(document => {
      if (active) setDrafts(current => ({ ...current, [approvalType]: fromDocument(document) }));
    }).catch((error: Error) => { if (active) setLoadError(error.message || '加载流程失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [approvalType, retry]);
  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if ((panelRef.current && path.includes(panelRef.current)) || (plusRef.current && path.includes(plusRef.current))) return;
      setPanelOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPanelOpen(false); plusRef.current?.focus(); } };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('keydown', onKeyDown); };
  }, [panelOpen]);

  const updateDraft = (update: (current: Draft) => Draft) => {
    setDrafts(current => {
      const previous = current[approvalType];
      return previous ? { ...current, [approvalType]: update(previous) } : current;
    });
  };
  const dirty = !!draft && (JSON.stringify(serializeApprovalWorkflow(draft.version, draft.nodes, draft.edges, draft.formFields)) !== draft.saved || Object.keys(draft.pendingApiKeys).length > 0);
  const configNode = draft?.nodes.find(node => node.id === configNodeId);
  const addNode = (kind: CustomApprovalNodeKind, position: { x: number; y: number }) => {
    if (!isNodeAvailable(approvalType, kind)) return;
    if (!draft || loading || saving) { message.info('请等待流程加载完成'); return; }
    if (draft.nodes.length >= 200) { message.warning('最多添加 200 个节点'); return; }
    updateDraft(current => ({ ...current, nodes: [...current.nodes, createApprovalNode(kind, position)] }));
    setPanelOpen(false);
  };
  const requestNode = (kind: CustomApprovalNodeKind) => {
    if (!isNodeAvailable(approvalType, kind)) return;
    if (!draft || loading || saving) { message.info('请等待流程加载完成'); return; }
    setPanelOpen(false);
    setAddRequest({ kind, id: ++nextAdd.current });
  };
  const onNodesChange: OnNodesChange<ApprovalNode> = changes => updateDraft(current => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }));
  const onEdgesChange: OnEdgesChange<ApprovalEdge> = changes => updateDraft(current => ({ ...current, edges: applyEdgeChanges(changes, current.edges) }));
  const onConnect: OnConnect = connection => {
    if (!draft || !connection.source || !connection.target) return;
    if (!canConnectApprovalNodes(new Set(draft.nodes.map(node => node.id)), draft.edges, connection.source, connection.target)) { message.warning('无法连接这些节点'); return; }
    if (draft.edges.length >= 400) { message.warning('最多添加 400 条连线'); return; }
    updateDraft(current => ({ ...current, edges: [...current.edges, createApprovalEdge(connection.source!, connection.target!)] }));
  };
  const onNodesDelete = (removed: ApprovalNode[]) => {
    const ids = new Set(removed.map(node => node.id));
    updateDraft(current => ({ ...current, edges: current.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)), pendingApiKeys: Object.fromEntries(Object.entries(current.pendingApiKeys).filter(([id]) => !ids.has(id))) }));
  };
  const configureNode = (id: string) => {
    const node = draft?.nodes.find(item => item.id === id);
    if (!node) return;
    if (node.data.kind === 'form') setFormOpen(true);
    else setConfigNodeId(id);
  };
  const saveFields = (fields: CustomApprovalField[]): boolean => {
    for (const edge of draft?.edges ?? []) for (const condition of edge.data?.conditions ?? []) {
      const definition = APPROVAL_TYPE_DEFINITIONS[approvalType];
      if (condition.field === definition?.numericCondition?.value || definition?.choices.some(choice => choice.value === condition.field)) continue;
      const field = fields.find(item => item.key === condition.field);
      if (!field || field.type !== 'picker' || !field.options?.includes(condition.value)) { message.error('该字段或选项已用于分支条件，请先修改分支条件'); return false; }
    }
    updateDraft(current => ({ ...current, formFields: fields }));
    return true;
  };
  const clear = () => modal.confirm({ title: '清空画布？', content: '清空后保存，才会更新设计稿。', okText: '清空', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => updateDraft(current => ({ ...current, nodes: [], edges: [], pendingApiKeys: {} })) });
  const save = async () => {
    if (!draft || !dirty || saving) return;
    const type = approvalType;
    setSaving(true);
    try {
      const credentials = Object.entries(draft.pendingApiKeys).map(([nodeId, apiKey]) => ({ nodeId, apiKey }));
      const saved = await saveCustomApprovalWorkflow(type, serializeApprovalWorkflow(draft.version, draft.nodes, draft.edges, draft.formFields), credentials);
      setDrafts(current => ({ ...current, [type]: fromDocument(saved) }));
      message.success('流程设计稿已保存');
    } catch (error) { message.error((error as Error).message || '保存失败，请重试'); }
    finally { setSaving(false); }
  };

  return <section className="payroll-workflow-page custom-approval-workflow" aria-label="自定义审批流程">
    <div className="salary-model-entries" role="toolbar" aria-label="流程操作">
      <button className="salary-model-entry" type="button" disabled={!draft || loading || saving} onClick={() => setFormOpen(true)}>表单设计</button>
      {toolbarExtra}
      <button className="salary-model-entry" type="button" disabled={!draft || loading || saving || (!draft.nodes.length && !draft.edges.length)} onClick={clear}>清空</button>
      <button className="salary-model-entry" type="button" disabled={!draft || loading || saving || !dirty} onClick={() => void save()}>保存</button>
    </div>
    {loadError && <Alert type="error" message="流程加载失败" action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
    <div className="payroll-workflow-editor">
      <div className="workflow-stage">
        <div className="workflow-rail" role="toolbar" aria-label="画布工具">
          <button ref={plusRef} type="button" className={`workflow-rail-button${panelOpen ? ' is-active' : ''}`} aria-label="添加节点" aria-expanded={panelOpen} onClick={() => setPanelOpen(value => !value)}><PlusOutlined /></button>
          <button type="button" className={`workflow-rail-button${tool === 'select' ? ' is-active' : ''}`} aria-label="选择模式" aria-pressed={tool === 'select'} onClick={() => { setTool('select'); setPanelOpen(false); }}><SelectOutlined /></button>
          <button type="button" className={`workflow-rail-button${tool === 'pan' ? ' is-active' : ''}`} aria-label="平移模式" aria-pressed={tool === 'pan'} onClick={() => { setTool('pan'); setPanelOpen(false); }}><DragOutlined /></button>
        </div>
        {mounted ? <ReactFlowProvider><CustomApprovalCanvas
          nodes={draft?.nodes ?? []} edges={draft?.edges ?? []} tool={tool} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodesDelete={onNodesDelete} onAdd={addNode} addRequest={addRequest} readOnly={!draft || loading || saving} onConfigure={configureNode} fields={draft?.formFields ?? []} approvalType={approvalType}
        /></ReactFlowProvider> : <div className="workflow-canvas-placeholder" />}
        {panelOpen && <div ref={panelRef} className="workflow-node-panel" role="dialog" aria-label="添加节点">
          {APPROVAL_NODE_PRESETS.filter(preset => isNodeAvailable(approvalType, preset.kind)).map(preset => <button key={preset.kind} type="button" className="workflow-node-option" draggable onDragStart={event => { event.dataTransfer.setData('application/approval-workflow-node', preset.kind); event.dataTransfer.effectAllowed = 'move'; }} onClick={() => requestNode(preset.kind)}>
            <span className={`workflow-node-icon approval-node-${preset.kind}`}><preset.icon /></span><span className="workflow-node-option-title">{preset.title}</span>
          </button>)}
        </div>}
      </div>
    </div>
    {formOpen && draft && approvalType && <ExpenseFormDesigner approvalType={approvalType} fields={draft.formFields} onCancel={() => setFormOpen(false)} onSave={saveFields} />}
    {configNode && draft && approvalType && <CustomApprovalNodeEditor key={configNode.id} approvalType={approvalType} node={configNode} nodes={draft.nodes} edges={draft.edges} fields={draft.formFields} hasPendingApiKey={!!draft.pendingApiKeys[configNode.id]} onCancel={() => setConfigNodeId(null)} onSave={(config, routes, apiKey) => {
      const nodeId = configNode.id;
      updateDraft(current => ({ ...current,
        nodes: current.nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data, ...(config ? { config } : {}) } } : node),
        edges: routes ? current.edges.map(edge => edge.source === nodeId ? { ...edge, data: { ...edge.data, conditions: routes[edge.id] ?? [] } } : edge) : current.edges,
        pendingApiKeys: apiKey ? { ...current.pendingApiKeys, [nodeId]: apiKey } : current.pendingApiKeys,
      }));
      setConfigNodeId(null);
    }} />}
  </section>;
}
