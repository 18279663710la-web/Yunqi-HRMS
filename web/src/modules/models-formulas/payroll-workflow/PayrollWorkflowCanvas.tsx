import { createContext, useContext, useEffect, useRef, useState, type DragEvent } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import type { PayrollWorkflowNodeKind } from '../../hr/api';
import { PayrollWorkflowIcon } from './PayrollWorkflowIcons';
import { PAYROLL_WORKFLOW_NODE_HEIGHT, PAYROLL_WORKFLOW_NODE_TYPE, PAYROLL_WORKFLOW_NODE_WIDTH, presetFor } from './workflowUtils';

export interface PayrollWorkflowNodeData extends Record<string, unknown> {
  kind: PayrollWorkflowNodeKind;
}

export type PayrollWorkflowNode = Node<PayrollWorkflowNodeData, 'payroll'>;
export type PayrollWorkflowEdge = Edge;
export type PayrollWorkflowTool = 'select' | 'pan';

const QuickAddContext = createContext<(id: string, rect: DOMRect) => void>(() => {});

function WorkflowNodeCard({ id, data, selected }: NodeProps<PayrollWorkflowNode>) {
  const preset = presetFor(data.kind);
  const quickAdd = useContext(QuickAddContext);
  const { deleteElements } = useReactFlow();
  return <div className={`workflow-node${selected ? ' is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="workflow-node-handle" />
    <PayrollWorkflowIcon kind={data.kind} />
    <div className="workflow-node-content">
      <div className="workflow-node-title">{preset.title}</div>
      <div className="workflow-node-meta">{preset.category}</div>
    </div>
    <button type="button" className="workflow-node-delete nodrag nopan" aria-label={`删除${preset.title}节点`} title="删除节点" onClick={event => {
      event.stopPropagation();
      void deleteElements({ nodes: [{ id }] });
    }}><DeleteOutlined /></button>
    <Handle type="source" position={Position.Right} className="workflow-node-handle" />
    <button type="button" className="workflow-node-add nodrag nopan" aria-label={`在${preset.title}后添加节点`} title="添加后续节点" onClick={event => {
      event.stopPropagation();
      quickAdd(id, event.currentTarget.getBoundingClientRect());
    }}><PlusOutlined /></button>
  </div>;
}

const nodeTypes = { [PAYROLL_WORKFLOW_NODE_TYPE]: WorkflowNodeCard } satisfies NodeTypes;

interface PayrollWorkflowCanvasProps {
  nodes: PayrollWorkflowNode[];
  edges: PayrollWorkflowEdge[];
  onNodesChange: OnNodesChange<PayrollWorkflowNode>;
  onEdgesChange: OnEdgesChange<PayrollWorkflowEdge>;
  onConnect: OnConnect;
  onNodesDelete: (nodes: PayrollWorkflowNode[]) => void;
  onDropNode: (kind: PayrollWorkflowNodeKind, position: { x: number; y: number }) => void;
  onPlaceNode: (kind: PayrollWorkflowNodeKind, position: { x: number; y: number }) => void;
  onQuickAdd: (id: string, rect: DOMRect) => void;
  placingKind: PayrollWorkflowNodeKind | null;
  tool: PayrollWorkflowTool;
  fitSignal: number;
}

export function PayrollWorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodesDelete,
  onDropNode,
  onPlaceNode,
  onQuickAdd,
  placingKind,
  tool,
  fitSignal,
}: PayrollWorkflowCanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow<PayrollWorkflowNode, PayrollWorkflowEdge>();
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fitSignal || !nodes.length) return;
    const frame = requestAnimationFrame(() => { void fitView({ padding: 0.2, maxZoom: 1 }); });
    return () => cancelAnimationFrame(frame);
  }, [fitSignal, fitView]);

  const centeredPosition = (point: { x: number; y: number }) => ({
    x: point.x - PAYROLL_WORKFLOW_NODE_WIDTH / 2,
    y: point.y - PAYROLL_WORKFLOW_NODE_HEIGHT / 2,
  });

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/payroll-node') as PayrollWorkflowNodeKind;
    if (!kind) return;
    onDropNode(kind, centeredPosition(screenToFlowPosition({ x: event.clientX, y: event.clientY })));
  };

  const ghostPreset = placingKind ? presetFor(placingKind) : null;

  return <div className="workflow-canvas" onDrop={onDrop} onDragOver={event => event.preventDefault()}>
    <QuickAddContext.Provider value={onQuickAdd}><ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodesDelete={onNodesDelete}
      nodeTypes={nodeTypes}
      deleteKeyCode={['Backspace', 'Delete']}
      connectOnClick
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      minZoom={0.4}
      maxZoom={1.6}
      panOnDrag={tool === 'pan' && !placingKind}
      selectionOnDrag={tool === 'select' && !placingKind}
      nodesDraggable={tool === 'select' && !placingKind}
      nodesConnectable={tool === 'select' && !placingKind}
      elementsSelectable={!placingKind}
      defaultEdgeOptions={{ type: 'default', style: { stroke: '#9aa9bf', strokeWidth: 2 } }}
      connectionLineStyle={{ stroke: '#3d6ef7', strokeWidth: 2 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cfd8e3" />
      <Controls showInteractive={false} />
    </ReactFlow></QuickAddContext.Provider>
    {placingKind && ghostPreset && <div
      ref={layerRef}
      className="workflow-placement-layer"
      onPointerMove={event => {
        const rect = layerRef.current?.getBoundingClientRect();
        if (rect) setGhost({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }}
      onClick={event => {
        onPlaceNode(placingKind, centeredPosition(screenToFlowPosition({ x: event.clientX, y: event.clientY })));
        setGhost(null);
      }}
    >
      {ghost && <div className="workflow-node workflow-node-ghost" style={{ left: ghost.x, top: ghost.y }}>
        <PayrollWorkflowIcon kind={placingKind} />
        <div className="workflow-node-content"><div className="workflow-node-title">{ghostPreset.title}</div>
        <div className="workflow-node-meta">{ghostPreset.category}</div></div>
      </div>}
    </div>}
  </div>;
}
