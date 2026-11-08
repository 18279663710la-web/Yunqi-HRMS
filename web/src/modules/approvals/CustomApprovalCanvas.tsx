import { createContext, useContext, useEffect, useMemo, useRef, type DragEvent } from 'react';
import { CheckCircleOutlined, DeleteOutlined, FileProtectOutlined, FileTextOutlined, ForkOutlined, PlayCircleOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, useReactFlow, type NodeProps, type NodeTypes, type OnConnect, type OnEdgesChange, type OnNodesChange } from '@xyflow/react';
import type { CustomApprovalField, CustomApprovalNodeKind } from './api';
import type { ApprovalEdge, ApprovalNode } from './customApprovalWorkflowGraph';

export const APPROVAL_NODE_PRESETS = [
  { kind: 'start', title: '发起人', icon: PlayCircleOutlined },
  { kind: 'verify', title: '系统查验', icon: FileProtectOutlined },
  { kind: 'approver', title: '审批人', icon: UserOutlined },
  { kind: 'branch', title: '条件分支', icon: ForkOutlined },
  { kind: 'end', title: '结束', icon: CheckCircleOutlined },
] as const;
const ALL_PRESETS = [...APPROVAL_NODE_PRESETS, { kind: 'form', title: '申请表单', icon: FileTextOutlined }] as const;
const NodeActions = createContext<{ configure: (id: string) => void; readOnly: boolean }>({ configure: () => {}, readOnly: true });

function ApprovalNodeCard({ id, data, selected }: NodeProps<ApprovalNode>) {
  const { deleteElements } = useReactFlow();
  const preset = ALL_PRESETS.find(item => item.kind === data.kind)!;
  const actions = useContext(NodeActions);
  const Icon = preset.icon;
  return <div className={`workflow-node${selected ? ' is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="workflow-node-handle" />
    <div className={`workflow-node-icon approval-node-${data.kind}`}><Icon /></div>
    <div className="workflow-node-content"><div className="workflow-node-title">{data.displayTitle || preset.title}</div>{data.summary && <div className="workflow-node-meta">{data.summary}</div>}</div>
    <button type="button" className="approval-node-config nodrag nopan" aria-label={`配置${preset.title}节点`} disabled={actions.readOnly} onClick={event => { event.stopPropagation(); actions.configure(id); }}><SettingOutlined /></button>
    <button type="button" className="workflow-node-delete nodrag nopan" aria-label={`删除${preset.title}节点`} onClick={event => { event.stopPropagation(); void deleteElements({ nodes: [{ id }] }); }}><DeleteOutlined /></button>
    <Handle type="source" position={Position.Right} className="workflow-node-handle" />
  </div>;
}
const nodeTypes = { approval: ApprovalNodeCard } satisfies NodeTypes;

interface Props {
  nodes: ApprovalNode[];
  edges: ApprovalEdge[];
  tool: 'select' | 'pan';
  onNodesChange: OnNodesChange<ApprovalNode>;
  onEdgesChange: OnEdgesChange<ApprovalEdge>;
  onConnect: OnConnect;
  onNodesDelete: (nodes: ApprovalNode[]) => void;
  onAdd: (kind: CustomApprovalNodeKind, position: { x: number; y: number }) => void;
  addRequest: { kind: CustomApprovalNodeKind; id: number } | null;
  readOnly: boolean;
  onConfigure: (id: string) => void;
  fields: CustomApprovalField[];
}

export function CustomApprovalCanvas({ nodes, edges, tool, onNodesChange, onEdgesChange, onConnect, onNodesDelete, onAdd, addRequest, readOnly, onConfigure, fields }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastAdd = useRef(0);
  const allowedKinds = useMemo<Set<CustomApprovalNodeKind>>(() => new Set(APPROVAL_NODE_PRESETS.map(item => item.kind)), []);
  const displayNodes = useMemo(() => {
    const groups = new Map<CustomApprovalNodeKind, ApprovalNode[]>();
    const outgoingByNode = new Map<string, ApprovalEdge[]>();
    for (const node of nodes) groups.set(node.data.kind, [...(groups.get(node.data.kind) ?? []), node]);
    for (const edge of edges) outgoingByNode.set(edge.source, [...(outgoingByNode.get(edge.source) ?? []), edge]);
    return nodes.map(node => {
      const outgoing = outgoingByNode.get(node.id) ?? [];
      const peers = groups.get(node.data.kind) ?? [];
      const baseTitle = ALL_PRESETS.find(item => item.kind === node.data.kind)?.title ?? '节点';
      const displayTitle = peers.length > 1 ? `${baseTitle} ${peers.findIndex(item => item.id === node.id) + 1}` : baseTitle;
      const summary = node.data.kind === 'approver' ? (node.data.config?.approverIds?.length ? `已选 ${node.data.config.approverIds.length} 人` : '未配置审批人')
        : node.data.kind === 'branch' ? (outgoing.length ? `已配置 ${outgoing.filter(edge => edge.data?.conditions?.length).length}/${outgoing.length} 条分支` : '未连接分支')
        : node.data.kind === 'start' ? '所有在职员工'
        : node.data.kind === 'verify' ? '发票查重与验真'
        : node.data.kind === 'end' ? (node.data.config?.outcome === 'rejected' ? '审批驳回' : '审批通过')
        : '表单设计';
      return { ...node, data: { ...node.data, summary, displayTitle } };
    });
  }, [nodes, edges]);
  const displayEdges = useMemo(() => edges.map(edge => {
    const label = edge.data?.conditions?.map(condition => {
      const name = condition.field === 'amount' ? '金额' : condition.field === 'expenseType' ? '报销类型' : fields.find(field => field.key === condition.field)?.label ?? condition.field;
      return `${name} ${condition.operator === 'gte' ? '≥' : condition.operator === 'lt' ? '<' : '='} ${condition.value}`;
    }).join(' 且 ');
    return label ? { ...edge, label, labelStyle: { fill: '#52647f', fontSize: 11 }, labelBgStyle: { fill: '#fff' } } : edge;
  }), [edges, fields]);
  useEffect(() => {
    if (!addRequest || addRequest.id === lastAdd.current || !canvasRef.current) return;
    lastAdd.current = addRequest.id;
    const bounds = canvasRef.current.getBoundingClientRect();
    const point = screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    const position = { x: point.x - 120, y: point.y - 32 };
    while (nodes.some(node => Math.abs(node.position.x - position.x) < 240 && Math.abs(node.position.y - position.y) < 88)) position.y += 88;
    onAdd(addRequest.kind, position);
  }, [addRequest, nodes.length, onAdd, screenToFlowPosition]);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/approval-workflow-node') as CustomApprovalNodeKind;
    if (!allowedKinds.has(kind)) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onAdd(kind, { x: point.x - 120, y: point.y - 32 });
  };
  return <div ref={canvasRef} className="workflow-canvas" onDrop={onDrop} onDragOver={event => event.preventDefault()}>
    <NodeActions.Provider value={{ configure: onConfigure, readOnly }}><ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodesDelete={onNodesDelete} onBeforeDelete={async () => !readOnly}
      deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} connectOnClick minZoom={0.4} maxZoom={1.6} panOnDrag={tool === 'pan'} selectionOnDrag={tool === 'select' && !readOnly}
      nodesDraggable={tool === 'select' && !readOnly} nodesConnectable={tool === 'select' && !readOnly} elementsSelectable={!readOnly} defaultEdgeOptions={{ type: 'default', style: { stroke: '#9aa9bf', strokeWidth: 2 } }}>
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cfd8e3" />
      <Controls showInteractive={false} />
    </ReactFlow></NodeActions.Provider>
  </div>;
}
