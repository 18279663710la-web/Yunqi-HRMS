import type { Edge, Node } from '@xyflow/react';
import type { CustomApprovalCondition, CustomApprovalField, CustomApprovalNodeConfig, CustomApprovalNodeKind, CustomApprovalWorkflow } from './api';

export type ApprovalNode = Node<{ kind: CustomApprovalNodeKind; config?: CustomApprovalNodeConfig; summary?: string; displayTitle?: string }, 'approval'>;
export type ApprovalEdge = Edge<{ conditions?: CustomApprovalCondition[] }>;

function id(prefix: string): string {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function createApprovalNode(kind: CustomApprovalNodeKind, position: { x: number; y: number }): ApprovalNode {
  return { id: id('node'), type: 'approval', position: { ...position }, data: { kind } };
}

export function createApprovalEdge(source: string, target: string): ApprovalEdge {
  return { id: id('edge'), source, target, type: 'default' };
}

/** 画布连线规则：不重复、不成环、发起人不可被连入、结束节点不可连出、非分支节点只能有一条后续连线。 */
export function canConnectApprovalNodes(
  nodes: Array<{ id: string; kind: CustomApprovalNodeKind }>,
  edges: Array<{ source: string; target: string }>,
  source: string,
  target: string,
): boolean {
  if (source === target) return false;
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const from = nodeMap.get(source);
  const to = nodeMap.get(target);
  if (!from || !to) return false;
  if (edges.some(edge => edge.source === source && edge.target === target)) return false;
  if (from.kind === 'end' || to.kind === 'start') return false;
  if (from.kind !== 'branch' && edges.some(edge => edge.source === source)) return false;
  // 成环检测：从 target 沿现有出边走，若能回到 source 则拒绝。
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return false;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return true;
}

/** 未写入的开关视为打开。两项都关时画布显示不查验。 */
export function verifyNodeSummary(config?: { checkDuplicate?: boolean; verifyInvoice?: boolean }): string {
  const duplicate = config?.checkDuplicate !== false;
  const authenticity = config?.verifyInvoice !== false;
  if (duplicate && authenticity) return '发票查重、发票验伪';
  if (duplicate) return '发票查重';
  if (authenticity) return '发票验伪';
  return '不查验';
}

export function serializeApprovalWorkflow(version: number, nodes: ApprovalNode[], edges: ApprovalEdge[], formFields?: CustomApprovalField[], fieldsInitialized?: boolean): CustomApprovalWorkflow {
  return {
    version,
    ...(fieldsInitialized ? { fieldsInitialized: true } : {}),
    ...(formFields === undefined ? {} : { formFields }),
    nodes: nodes.map(node => ({ id: node.id, kind: node.data.kind, position: { x: node.position.x, y: node.position.y }, ...(node.data.config ? { config: node.data.config } : {}) })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, ...(edge.data?.conditions ? { conditions: edge.data.conditions } : {}) })),
  };
}
