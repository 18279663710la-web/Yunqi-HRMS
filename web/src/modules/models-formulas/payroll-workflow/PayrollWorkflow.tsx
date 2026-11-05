import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Space, Spin, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import { ApiError } from '../../../api/client';
import {
  getPayrollWorkflow,
  savePayrollWorkflow,
  type PayrollWorkflowEdgeSnapshot,
  type PayrollWorkflowNodeKind,
  type PayrollWorkflowNodeSnapshot,
} from '../../hr/api';
import { PayrollWorkflowCanvas, type PayrollWorkflowEdge, type PayrollWorkflowNode, type PayrollWorkflowTool } from './PayrollWorkflowCanvas';
import { PayrollWorkflowIcon } from './PayrollWorkflowIcons';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import {
  PAYROLL_WORKFLOW_PRESETS,
  canConnect,
  createWorkflowEdge,
  createLinkedWorkflowAddition,
  createWorkflowNode,
  serializeWorkflow,
  workflowSignature,
} from './workflowUtils';

const toFlowNode = (node: PayrollWorkflowNodeSnapshot): PayrollWorkflowNode => ({ ...node, type: 'payroll' });
const toFlowEdge = (edge: PayrollWorkflowEdgeSnapshot): PayrollWorkflowEdge => ({
  ...edge,
  type: 'default',
  style: { stroke: '#9aa9bf', strokeWidth: 2 },
});

function CursorIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
  </svg>;
}

function HandIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>;
}

export function PayrollWorkflow() {
  const { message, modal } = App.useApp();
  const [nodes, setNodes] = useState<PayrollWorkflowNode[]>([]);
  const [edges, setEdges] = useState<PayrollWorkflowEdge[]>([]);
  const [version, setVersion] = useState(1);
  const [savedSignature, setSavedSignature] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [tool, setTool] = useState<PayrollWorkflowTool>('select');
  const [panelOpen, setPanelOpen] = useState(false);
  const [placingKind, setPlacingKind] = useState<PayrollWorkflowNodeKind | null>(null);
  const [quickSource, setQuickSource] = useState<string | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | undefined>();
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    setLoading(true); setFailed(false);
    try {
      const document = await getPayrollWorkflow();
      setVersion(document.version);
      setNodes(document.nodes.map(toFlowNode));
      setEdges(document.edges.map(toFlowEdge));
      setSavedSignature(workflowSignature(document.version, document.nodes, document.edges));
      setFitSignal(value => value + 1);
    } catch (error) {
      setFailed(true);
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      if (plusRef.current && path.includes(plusRef.current)) return;
      setPanelOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [panelOpen]);
  useEffect(() => {
    if (!panelOpen && !placingKind) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPanelOpen(false);
      setPlacingKind(null);
      setQuickSource(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panelOpen, placingKind]);

  const dirty = workflowSignature(version, nodes, edges) !== savedSignature;

  const onNodesChange: OnNodesChange<PayrollWorkflowNode> = changes => setNodes(current => applyNodeChanges(changes, current));
  const onEdgesChange: OnEdgesChange<PayrollWorkflowEdge> = changes => setEdges(current => applyEdgeChanges(changes, current));
  const onConnect: OnConnect = connection => {
    if (!connection.source || !connection.target) return;
    const result = canConnect(new Set(nodes.map(node => node.id)), edges, connection.source, connection.target);
    if (!result.ok) { message.warning(result.reason ?? '无法连接'); return; }
    setEdges(current => [...current, toFlowEdge(createWorkflowEdge(connection.source!, connection.target!))]);
  };
  const onNodesDelete = (deleted: PayrollWorkflowNode[]) => {
    const removed = new Set(deleted.map(node => node.id));
    setEdges(current => current.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)));
  };
  const addNode = (kind: PayrollWorkflowNodeKind, position: { x: number; y: number }) => {
    setNodes(current => [...current, toFlowNode(createWorkflowNode(kind, position))]);
  };
  const dropNode = (kind: PayrollWorkflowNodeKind, position: { x: number; y: number }) => {
    addNode(kind, position);
    setPanelOpen(false);
    setPlacingKind(null);
  };
  const placeNode = (kind: PayrollWorkflowNodeKind, position: { x: number; y: number }) => {
    addNode(kind, position);
    setPlacingKind(null);
  };
  const choosePreset = (kind: PayrollWorkflowNodeKind) => {
    setPanelOpen(false);
    if (quickSource) {
      const addition = createLinkedWorkflowAddition(kind, quickSource, nodes);
      if (addition) {
        setNodes(current => [...current, toFlowNode(addition.node)]);
        setEdges(current => [...current, toFlowEdge(addition.edge)]);
      }
      setQuickSource(null);
      return;
    }
    setPlacingKind(kind);
  };
  const openQuickAdd = (id: string, rect: DOMRect) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const panelWidth = Math.min(248, stage.width - 24);
    const right = rect.right - stage.left + 8;
    const left = right + panelWidth <= stage.width - 12 ? right : rect.left - stage.left - panelWidth - 8;
    setPanelPosition({ left: Math.max(12, left), top: Math.max(12, Math.min(rect.top - stage.top, stage.height - 330)) });
    setQuickSource(id);
    setPlacingKind(null);
    setPanelOpen(true);
  };
  const chooseTool = (next: PayrollWorkflowTool) => {
    setTool(next);
    setPanelOpen(false);
    setPlacingKind(null);
    setQuickSource(null);
  };
  const togglePanel = () => {
    setPanelOpen(value => !value);
    setPlacingKind(null);
    setQuickSource(null);
    setPanelPosition(undefined);
  };
  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const saved = await savePayrollWorkflow(serializeWorkflow(version, nodes, edges));
      setVersion(saved.version);
      setNodes(saved.nodes.map(toFlowNode));
      setEdges(saved.edges.map(toFlowEdge));
      setSavedSignature(workflowSignature(saved.version, saved.nodes, saved.edges));
      message.success('流程已保存');
    } catch (error) {
      message.error((error as Error).message);
      if (error instanceof ApiError && error.status === 409) await load();
    } finally {
      setSaving(false);
    }
  };
  const clear = () => {
    modal.confirm({
      title: '清空画布？',
      content: '清空后需保存才会生效。',
      okText: '清空', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: () => { setNodes([]); setEdges([]); setPanelOpen(false); setPlacingKind(null); },
    });
  };

  return <section className="payroll-workflow-page" aria-label="薪资发放流程">
    <SubModuleHeader title="薪资发放流程" extra={<Space>
      <Button onClick={clear} disabled={loading || saving || (!nodes.length && !edges.length)}>清空</Button>
      <Button type="primary" onClick={() => void save()} loading={saving} disabled={loading || failed || !dirty}>保存</Button>
    </Space>} />
    {failed && <Alert type="error" message="流程加载失败" action={<Button size="small" onClick={() => void load()}>重试</Button>} style={{ marginBottom: 16 }} />}
    <Spin spinning={loading}>
      <div className="payroll-workflow-editor">
        <div ref={stageRef} className="workflow-stage">
          <div className="workflow-rail" role="toolbar" aria-label="画布工具">
            <Tooltip title="添加节点" placement="right">
              <button ref={plusRef} type="button" className={`workflow-rail-button${panelOpen || placingKind ? ' is-active' : ''}`} aria-label="添加节点" aria-expanded={panelOpen} onClick={togglePanel}><PlusOutlined /></button>
            </Tooltip>
            <Tooltip title="选择" placement="right">
              <button type="button" className={`workflow-rail-button${tool === 'select' && !panelOpen && !placingKind ? ' is-active' : ''}`} aria-label="选择模式" aria-pressed={tool === 'select'} onClick={() => chooseTool('select')}><CursorIcon /></button>
            </Tooltip>
            <Tooltip title="平移" placement="right">
              <button type="button" className={`workflow-rail-button${tool === 'pan' && !panelOpen && !placingKind ? ' is-active' : ''}`} aria-label="平移模式" aria-pressed={tool === 'pan'} onClick={() => chooseTool('pan')}><HandIcon /></button>
            </Tooltip>
          </div>
          {mounted ? <ReactFlowProvider>
            <PayrollWorkflowCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodesDelete={onNodesDelete}
              onDropNode={dropNode}
              onPlaceNode={placeNode}
              onQuickAdd={openQuickAdd}
              placingKind={placingKind}
              tool={tool}
              fitSignal={fitSignal}
            />
          </ReactFlowProvider> : <div className="workflow-canvas-placeholder" />}
          {panelOpen && <div ref={panelRef} className="workflow-node-panel" style={panelPosition} role="dialog" aria-label="添加节点">
            {PAYROLL_WORKFLOW_PRESETS.map(preset => <button
              key={preset.kind}
              type="button"
              className="workflow-node-option"
              draggable={!quickSource}
              onDragStart={event => {
                event.dataTransfer.setData('application/payroll-node', preset.kind);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => choosePreset(preset.kind)}
            >
              <PayrollWorkflowIcon kind={preset.kind} />
              <span className="workflow-node-option-text">
                <span className="workflow-node-option-title">{preset.title}</span>
                <span className="workflow-node-option-meta">{preset.category}</span>
              </span>
            </button>)}
          </div>}
        </div>
      </div>
    </Spin>
  </section>;
}
