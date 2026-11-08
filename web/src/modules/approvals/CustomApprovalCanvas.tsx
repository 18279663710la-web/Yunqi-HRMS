import { useEffect, useMemo, useRef, type DragEvent } from 'react';
import { DeleteOutlined, FileTextOutlined, ForkOutlined, UserOutlined } from '@ant-design/icons';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, useReactFlow, type NodeProps, type NodeTypes, type OnConnect, type OnEdgesChange, type OnNodesChange } from '@xyflow/react';
import type { CustomApprovalNodeKind } from './api';
import type { ApprovalEdge, ApprovalNode } from './customApprovalWorkflowGraph';

export const APPROVAL_NODE_PRESETS = [
  { kind: 'form', title: '申请表单', icon: FileTextOutlined },
  { kind: 'approver', title: '审批人', icon: UserOutlined },
  { kind: 'branch', title: '条件分支', icon: ForkOutlined },
] as const;

function ApprovalNodeCard({ id, data, selected }: NodeProps<ApprovalNode>) {
  const { deleteElements } = useReactFlow();
  const preset = APPROVAL_NODE_PRESETS.find(item => item.kind === data.kind)!;
  const Icon = preset.icon;
  return <div className={`workflow-node${selected ? ' is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="workflow-node-handle" />
    <div className={`workflow-node-icon approval-node-${data.kind}`}><Icon /></div>
    <div className="workflow-node-content"><div className="workflow-node-title">{preset.title}</div></div>
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
}

export function CustomApprovalCanvas({ nodes, edges, tool, onNodesChange, onEdgesChange, onConnect, onNodesDelete, onAdd, addRequest, readOnly }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastAdd = useRef(0);
  const allowedKinds = useMemo(() => new Set(APPROVAL_NODE_PRESETS.map(item => item.kind)), []);
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
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodesDelete={onNodesDelete} onBeforeDelete={async () => !readOnly}
      deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} connectOnClick minZoom={0.4} maxZoom={1.6} panOnDrag={tool === 'pan'} selectionOnDrag={tool === 'select' && !readOnly}
      nodesDraggable={tool === 'select' && !readOnly} nodesConnectable={tool === 'select' && !readOnly} elementsSelectable={!readOnly} defaultEdgeOptions={{ type: 'default', style: { stroke: '#9aa9bf', strokeWidth: 2 } }}>
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cfd8e3" />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}
