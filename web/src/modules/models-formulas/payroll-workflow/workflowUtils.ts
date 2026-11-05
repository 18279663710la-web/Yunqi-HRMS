import type { PayrollWorkflow, PayrollWorkflowEdgeSnapshot, PayrollWorkflowNodeKind, PayrollWorkflowNodeSnapshot } from '../../hr/api';

export interface PayrollWorkflowPreset {
  kind: PayrollWorkflowNodeKind;
  title: string;
  category: string;
}

export const PAYROLL_WORKFLOW_PRESETS: PayrollWorkflowPreset[] = [
  { kind: 'system-calc', title: '系统算薪', category: '系统' },
  { kind: 'manual-adjust', title: '手动调整', category: '人工' },
  { kind: 'review', title: '复核', category: '人工' },
  { kind: 'payslip', title: '输出工资条', category: '输出' },
  { kind: 'send-miniprogram', title: '发送到对应员工的小程序端', category: '同步' },
  { kind: 'import-fields', title: '导入其他字段', category: '数据' },
];

export const PAYROLL_WORKFLOW_NODE_TYPE = 'payroll';
export const PAYROLL_WORKFLOW_NODE_WIDTH = 240;
export const PAYROLL_WORKFLOW_NODE_HEIGHT = 64;

const presetMap = new Map(PAYROLL_WORKFLOW_PRESETS.map(preset => [preset.kind, preset]));

export function presetFor(kind: PayrollWorkflowNodeKind): PayrollWorkflowPreset {
  return presetMap.get(kind) ?? PAYROLL_WORKFLOW_PRESETS[0];
}

export interface WorkflowPoint {
  x: number;
  y: number;
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export function createWorkflowNode(kind: PayrollWorkflowNodeKind, position: WorkflowPoint): PayrollWorkflowNodeSnapshot {
  return { id: createId('node'), type: PAYROLL_WORKFLOW_NODE_TYPE, position: { x: position.x, y: position.y }, data: { kind } };
}

export function createWorkflowEdge(source: string, target: string): PayrollWorkflowEdgeSnapshot {
  return { id: createId('edge'), source, target };
}

export function createLinkedWorkflowAddition(
  kind: PayrollWorkflowNodeKind,
  sourceId: string,
  nodes: Array<{ id: string; position: WorkflowPoint }>
): { node: PayrollWorkflowNodeSnapshot; edge: PayrollWorkflowEdgeSnapshot } | null {
  const source = nodes.find(node => node.id === sourceId);
  if (!source) return null;
  const position = { x: source.position.x + PAYROLL_WORKFLOW_NODE_WIDTH + 100, y: source.position.y };
  while (nodes.some(node => Math.abs(node.position.x - position.x) < PAYROLL_WORKFLOW_NODE_WIDTH && Math.abs(node.position.y - position.y) < PAYROLL_WORKFLOW_NODE_HEIGHT + 24)) {
    position.y += PAYROLL_WORKFLOW_NODE_HEIGHT + 24;
  }
  const node = createWorkflowNode(kind, position);
  return { node, edge: createWorkflowEdge(source.id, node.id) };
}

export function canConnect(
  nodeIds: Set<string>,
  edges: Array<{ source: string; target: string }>,
  source: string,
  target: string
): { ok: boolean; reason?: string } {
  if (!nodeIds.has(source) || !nodeIds.has(target)) return { ok: false, reason: '节点不存在' };
  if (source === target) return { ok: false, reason: '不能连接节点自身' };
  if (edges.some(edge => edge.source === source && edge.target === target)) return { ok: false, reason: '不能重复连接相同节点' };
  return { ok: true };
}

export interface WorkflowFlowNodeInput {
  id: string;
  type?: string;
  position: WorkflowPoint;
  data: { kind: PayrollWorkflowNodeKind };
}

export interface WorkflowFlowEdgeInput {
  id: string;
  source: string;
  target: string;
}

export function serializeWorkflow(
  version: number,
  nodes: WorkflowFlowNodeInput[],
  edges: WorkflowFlowEdgeInput[]
): PayrollWorkflow {
  return {
    version,
    nodes: nodes.map(node => ({
      id: node.id,
      type: PAYROLL_WORKFLOW_NODE_TYPE,
      position: { x: node.position.x, y: node.position.y },
      data: { kind: node.data.kind },
    })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })),
  };
}

export function workflowSignature(version: number, nodes: WorkflowFlowNodeInput[], edges: WorkflowFlowEdgeInput[]): string {
  return JSON.stringify(serializeWorkflow(version, nodes, edges));
}
