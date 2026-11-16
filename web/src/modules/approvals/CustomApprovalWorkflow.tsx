import { useEffect, useRef, useState } from 'react';
import { ClearOutlined, CloudUploadOutlined, DragOutlined, ExperimentOutlined, FileSearchOutlined, FormOutlined, PlusOutlined, SaveOutlined, SelectOutlined } from '@ant-design/icons';
import { Alert, App, Button, Tooltip } from 'antd';
import { ReactFlowProvider, applyEdgeChanges, applyNodeChanges, type OnConnect, type OnEdgesChange, type OnNodesChange } from '@xyflow/react';
import { APPROVAL_NODE_PRESETS, CustomApprovalCanvas } from './CustomApprovalCanvas';
import { ExpenseFormDesigner } from './ExpenseFormDesigner';
import { CustomApprovalNodeEditor } from './CustomApprovalNodeEditor';
import { ApprovalTestCases } from './ApprovalTestCases';
import { canConnectApprovalNodes, createApprovalEdge, createApprovalNode, serializeApprovalWorkflow, type ApprovalEdge, type ApprovalNode } from './customApprovalWorkflowGraph';
import { getCustomApprovalWorkflow, saveCustomApprovalWorkflow, getWorkflowTestFields, getWorkflowTestCases, testSavedWorkflow, publishWorkflow, getWorkflowPublication, type WorkflowTestCasesDocument, type WorkflowTestField, type CustomApprovalField, type CustomApprovalNodeKind, type CustomApprovalType, type CustomApprovalWorkflow as WorkflowDocument } from './api';
import { FallbackApproverSelect } from './FallbackApproverSelect';
import { APPROVAL_TYPE_DEFINITIONS, isNodeAvailable } from './approvalTypeDefinitions';
import { SubModuleHeader } from '../../components/SubModuleHeader';

interface Draft { version: number; nodes: ApprovalNode[]; edges: ApprovalEdge[]; formFields: CustomApprovalField[]; fieldsInitialized: boolean; saved: string; pendingApiKeys: Record<string, string> }
function fromDocument(document: WorkflowDocument): Draft {
  const formFields = document.formFields ?? [];
  const fieldsInitialized = document.fieldsInitialized === true;
  const nodes: ApprovalNode[] = document.nodes.map(node => ({ id: node.id, type: 'approval', position: node.position, data: { kind: node.kind, ...(node.config ? { config: node.config } : {}) } }));
  const edges: ApprovalEdge[] = document.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'default', ...(edge.conditions ? { data: { conditions: edge.conditions } } : {}) }));
  return { version: document.version, nodes, edges, formFields, fieldsInitialized, saved: JSON.stringify(serializeApprovalWorkflow(document.version, nodes, edges, formFields, fieldsInitialized)), pendingApiKeys: {} };
}

export function CustomApprovalWorkflow({ approvalType }: { approvalType: CustomApprovalType }) {
  const { message, modal } = App.useApp();
  const [mounted, setMounted] = useState(false);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [drafts, setDrafts] = useState<Partial<Record<CustomApprovalType, Draft>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<boolean | null>(null);
  const [publicationState, setPublicationState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [publicationRetry, setPublicationRetry] = useState(0);
  const [testEditor, setTestEditor] = useState<{ fields: WorkflowTestField[]; document: WorkflowTestCasesDocument } | null>(null);
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
    let active = true;
    setPublished(null);
    setPublicationState('loading');
    getWorkflowPublication(approvalType)
      .then((result) => { if (active) { setPublished(result !== null); setPublicationState('ready'); } })
      .catch(() => { if (active) setPublicationState('failed'); });
    return () => { active = false; };
  }, [approvalType, publicationRetry]);
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
  const dirty = !!draft && (JSON.stringify(serializeApprovalWorkflow(draft.version, draft.nodes, draft.edges, draft.formFields, draft.fieldsInitialized)) !== draft.saved || Object.keys(draft.pendingApiKeys).length > 0);
  const configNode = draft?.nodes.find(node => node.id === configNodeId);
  const addNode = (kind: CustomApprovalNodeKind, position: { x: number; y: number }) => {
    if (!isNodeAvailable(approvalType, kind)) return;
    if (!draft || loading || saving || testing || publishing) { message.info('请等待流程加载完成'); return; }
    if (draft.nodes.length >= 200) { message.warning('最多添加 200 个节点'); return; }
    updateDraft(current => ({ ...current, nodes: [...current.nodes, createApprovalNode(kind, position)] }));
    setPanelOpen(false);
  };
  const requestNode = (kind: CustomApprovalNodeKind) => {
    if (!isNodeAvailable(approvalType, kind)) return;
    if (!draft || loading || saving || testing || publishing) { message.info('请等待流程加载完成'); return; }
    setPanelOpen(false);
    setAddRequest({ kind, id: ++nextAdd.current });
  };
  const onNodesChange: OnNodesChange<ApprovalNode> = changes => updateDraft(current => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }));
  const onEdgesChange: OnEdgesChange<ApprovalEdge> = changes => updateDraft(current => ({ ...current, edges: applyEdgeChanges(changes, current.edges) }));
  const onConnect: OnConnect = connection => {
    if (!draft || !connection.source || !connection.target) return;
    if (!canConnectApprovalNodes(draft.nodes.map(node => ({ id: node.id, kind: node.data.kind })), draft.edges, connection.source, connection.target)) {
      message.warning('无法连接：不能成环、重复连线，发起人不可被连入，结束节点与普通节点只能有一条后续连线');
      return;
    }
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
      if (condition.field === definition?.numericCondition?.value) continue;
      const field = fields.find(item => item.key === condition.field);
      const preset = definition?.choices.find(choice => choice.value === condition.field);
      const options = field?.type === 'picker' ? field.options : field ? undefined : preset?.options;
      if (!options?.includes(condition.value)) { message.error('该字段或选项已用于分支条件，请先修改分支条件'); return false; }
    }
    updateDraft(current => ({ ...current, formFields: fields, fieldsInitialized: true }));
    return true;
  };
  const openTestCases = async () => {
    if (!draft || testing) return;
    setTesting(true);
    try {
      const [fixed, document] = await Promise.all([getWorkflowTestFields(approvalType), getWorkflowTestCases(approvalType)]);
      const customKeys = new Set(draft.formFields.map(field => field.key));
      setTestEditor({ fields: [...draft.formFields.filter((field): field is WorkflowTestField => field.type !== 'attachment'), ...fixed.fields.filter(field => !customKeys.has(field.key))], document });
    } catch (error) { message.error((error as Error).message || '加载测试用例失败'); }
    finally { setTesting(false); }
  };
  const runSavedTests = async () => {
    if (!draft || testing) return;
    setTesting(true);
    try {
      const report = await testSavedWorkflow(approvalType);
      const graph = serializeApprovalWorkflow(draft.version, draft.nodes, draft.edges, draft.formFields, draft.fieldsInitialized);
      const titles: Record<string, string> = { start: '发起人', form: '申请表单', verify: '系统查验（模拟）', ai: 'AI 审批', approver: '审批人', branch: '条件分支', end: '结束' };
      const nodes = new Map(graph.nodes.map(node => [node.id, titles[node.kind]]));
      modal.info({ title: report.passed ? '测试通过' : '测试未通过', width: 680, content: <div className="approval-test-report">
        {report.errors.map(error => <div key={error}>{error}</div>)}
        {report.aiChecks.map(item => <div key={item.nodeId}>AI 接口：{item.reachable ? `可达（HTTP ${item.status}）` : '无法连接'}</div>)}
        {report.cases.map((item, index) => <div key={index} className="approval-test-report-case"><strong>{item.name}：{item.passed ? '通过' : '未通过'}</strong><div>{item.path.map(id => nodes.get(id) || id).join(' → ')}</div>{item.approverIds.length > 0 && <div>审批人：{item.approverIds.join(' → ')}</div>}{item.outcome && <div>结束结果：{item.outcome === 'approved' ? '审批通过' : '审批驳回'}</div>}{item.error && <div>{item.error}</div>}</div>)}
      </div> });
    } catch (error) { message.error((error as Error).message || '测试失败'); }
    finally { setTesting(false); }
  };
  const runTests = () => {
    if (!draft || testing || saving || publishing) return;
    if (dirty) {
      modal.confirm({ title: '保存流程后测试？', okText: '保存并测试', cancelText: '取消', onOk: async () => { if ((await save()) !== null) await runSavedTests(); } });
      return;
    }
    void runSavedTests();
  };
  const clear = () => modal.confirm({ title: '清空画布？', content: '清空后保存，才会更新设计稿。', okText: '清空', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => updateDraft(current => ({ ...current, nodes: [], edges: [], pendingApiKeys: {} })) });
  const save = async (): Promise<number | null> => {
    if (!draft || saving || publishing) return null;
    if (!dirty) return draft.version;
    const type = approvalType;
    setSaving(true);
    try {
      const credentials = Object.entries(draft.pendingApiKeys).map(([nodeId, apiKey]) => ({ nodeId, apiKey }));
      const saved = await saveCustomApprovalWorkflow(type, serializeApprovalWorkflow(draft.version, draft.nodes, draft.edges, draft.formFields, draft.fieldsInitialized), credentials);
      setDrafts(current => ({ ...current, [type]: fromDocument(saved) }));
      message.success('流程设计稿已保存');
      return saved.version;
    } catch (error) { message.error((error as Error).message || '保存失败，请重试'); return null; }
    finally { setSaving(false); }
  };

  const publishSaved = async (version: number) => {
    if (publishing) return;
    setPublishing(true);
    try {
      const cases = await getWorkflowTestCases(approvalType);
      await publishWorkflow(approvalType, version, cases.version);
      setPublished(true);
      message.success('审批流程已发布');
    } catch (error) { message.error((error as Error).message || '发布失败'); }
    finally { setPublishing(false); }
  };
  const publish = () => {
    if (!draft || loading || saving || testing || publishing) return;
    if (dirty) {
      modal.confirm({ title: '流程尚未保存，是否保存后发布？', okText: '保存并发布', cancelText: '取消', onOk: async () => { const version = await save(); if (version !== null) await publishSaved(version); } });
      return;
    }
    void publishSaved(draft.version);
  };

  return <section className="payroll-workflow-page custom-approval-workflow" aria-label="自定义审批流程">
    <SubModuleHeader title={`${APPROVAL_TYPE_DEFINITIONS[approvalType].name}审批`} />
    <div className="filter-bar" role="toolbar" aria-label="流程操作">
      <Tooltip title="表单设计" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="表单设计" icon={<FormOutlined />} disabled={!draft || loading || saving || testing || publishing} onClick={() => setFormOpen(true)} />
      </Tooltip>
      {published === false && <FallbackApproverSelect approvalType={approvalType} />}
      <Tooltip title="清空画布" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="清空画布" icon={<ClearOutlined />} disabled={!draft || loading || saving || testing || publishing || (!draft.nodes.length && !draft.edges.length)} onClick={clear} />
      </Tooltip>
      <Tooltip title="保存" arrow={false} overlayClassName="app-tooltip">
        <Button className="filter-circle" type="text" aria-label="保存" icon={<SaveOutlined />} disabled={!draft || loading || saving || testing || publishing || !dirty} onClick={() => void save()} />
      </Tooltip>
      <div className="payroll-actions-right">
        <Tooltip title="发布" arrow={false} overlayClassName="app-tooltip">
          <Button className="filter-circle filter-primary-circle" type="text" aria-label="发布" icon={<CloudUploadOutlined />} disabled={!draft || loading || saving || testing || publishing} onClick={publish} />
        </Tooltip>
      </div>
    </div>
    {loadError && <Alert type="error" message="流程加载失败" action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
    {publicationState === 'failed' && <Alert type="warning" message="发布状态加载失败，指定审批人入口暂不可用" action={<Button size="small" onClick={() => setPublicationRetry(value => value + 1)}>重试</Button>} />}
    <div className="payroll-workflow-editor">
      <div className="workflow-stage">
        <div className="workflow-rail" role="toolbar" aria-label="画布工具">
          <button ref={plusRef} type="button" disabled={!draft || loading || saving || testing || publishing} className={`workflow-rail-button${panelOpen ? ' is-active' : ''}`} aria-label="添加节点" aria-expanded={panelOpen} onClick={() => setPanelOpen(value => !value)}><PlusOutlined /></button>
          <button type="button" className={`workflow-rail-button${tool === 'select' ? ' is-active' : ''}`} aria-label="选择模式" aria-pressed={tool === 'select'} onClick={() => { setTool('select'); setPanelOpen(false); }}><SelectOutlined /></button>
          <button type="button" className={`workflow-rail-button${tool === 'pan' ? ' is-active' : ''}`} aria-label="平移模式" aria-pressed={tool === 'pan'} onClick={() => { setTool('pan'); setPanelOpen(false); }}><DragOutlined /></button>
          <button type="button" className="workflow-rail-button" aria-label="测试用例" title="测试用例" disabled={!draft || loading || saving || testing || publishing} onClick={() => { setPanelOpen(false); void openTestCases(); }}><FileSearchOutlined /></button>
          <button type="button" className="workflow-rail-button" aria-label="测试" title="测试" disabled={!draft || loading || saving || testing || publishing} onClick={() => { setPanelOpen(false); runTests(); }}><ExperimentOutlined /></button>
        </div>
        {mounted ? <ReactFlowProvider><CustomApprovalCanvas
          nodes={draft?.nodes ?? []} edges={draft?.edges ?? []} tool={tool} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodesDelete={onNodesDelete} onAdd={addNode} addRequest={addRequest} readOnly={!draft || loading || saving || testing || publishing} onConfigure={configureNode} fields={draft?.formFields ?? []} approvalType={approvalType}
        /></ReactFlowProvider> : <div className="workflow-canvas-placeholder" />}
        {panelOpen && <div ref={panelRef} className="workflow-node-panel" role="dialog" aria-label="添加节点">
          {APPROVAL_NODE_PRESETS.filter(preset => isNodeAvailable(approvalType, preset.kind)).map(preset => <button key={preset.kind} type="button" className="workflow-node-option" draggable onDragStart={event => { event.dataTransfer.setData('application/approval-workflow-node', preset.kind); event.dataTransfer.effectAllowed = 'move'; }} onClick={() => requestNode(preset.kind)}>
            <span className={`workflow-node-icon approval-node-${preset.kind}`}><preset.icon /></span><span className="workflow-node-option-title">{preset.title}</span>
          </button>)}
        </div>}
      </div>
    </div>
    {formOpen && draft && approvalType && <ExpenseFormDesigner approvalType={approvalType} fields={draft.formFields} initialized={draft.fieldsInitialized} onCancel={() => setFormOpen(false)} onSave={saveFields} />}
    {configNode && draft && approvalType && <CustomApprovalNodeEditor key={configNode.id} approvalType={approvalType} node={configNode} nodes={draft.nodes} edges={draft.edges} fields={draft.formFields} hasPendingApiKey={!!draft.pendingApiKeys[configNode.id]} onCancel={() => setConfigNodeId(null)} onSave={(config, routes, apiKey) => {
      const nodeId = configNode.id;
      updateDraft(current => ({ ...current,
        nodes: current.nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data, ...(config ? { config } : {}) } } : node),
        edges: routes ? current.edges.map(edge => edge.source === nodeId ? { ...edge, data: { ...edge.data, conditions: routes[edge.id] ?? [] } } : edge) : current.edges,
        pendingApiKeys: apiKey ? { ...current.pendingApiKeys, [nodeId]: apiKey } : current.pendingApiKeys,
      }));
      setConfigNodeId(null);
    }} />}
    {testEditor && <ApprovalTestCases approvalType={approvalType} fields={testEditor.fields} document={testEditor.document} onCancel={() => setTestEditor(null)} onSaved={() => setTestEditor(null)} />}
  </section>;
}
