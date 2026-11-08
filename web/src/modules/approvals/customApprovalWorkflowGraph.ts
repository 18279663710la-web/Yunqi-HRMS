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

export function canConnectApprovalNodes(nodeIds: Set<string>, edges: Array<{ source: string; target: string }>, source: string, target: string): boolean {
  return nodeIds.has(source) && nodeIds.has(target) && source !== target && !edges.some(edge => edge.source === source && edge.target === target);
}

export function serializeApprovalWorkflow(version: number, nodes: ApprovalNode[], edges: ApprovalEdge[], formFields?: CustomApprovalField[]): CustomApprovalWorkflow {
  return {
    version,
    ...(formFields === undefined ? {} : { formFields }),
    nodes: nodes.map(node => ({ id: node.id, kind: node.data.kind, position: { x: node.position.x, y: node.position.y }, ...(node.data.config ? { config: node.data.config } : {}) })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, ...(edge.data?.conditions ? { conditions: edge.data.conditions } : {}) })),
  };
}
