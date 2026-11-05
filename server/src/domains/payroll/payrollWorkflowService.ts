import type { PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import { transaction } from '../../shared/db/pool';
import { conflict } from '../../shared/utils/errors';
import { ensureWorkflow, findWorkflow, updateWorkflow } from './payrollWorkflowRepository';

export const PAYROLL_WORKFLOW_KEY = 'payroll_workflow';
export const PAYROLL_WORKFLOW_KINDS = ['system-calc', 'manual-adjust', 'review', 'payslip', 'send-miniprogram', 'import-fields'] as const;
export type PayrollWorkflowNodeKind = typeof PAYROLL_WORKFLOW_KINDS[number];

export interface PayrollWorkflowNode {
  id: string;
  type: 'payroll';
  position: { x: number; y: number };
  data: { kind: PayrollWorkflowNodeKind };
}

export interface PayrollWorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface PayrollWorkflow {
  version: number;
  nodes: PayrollWorkflowNode[];
  edges: PayrollWorkflowEdge[];
}

const kindSchema = z.enum(PAYROLL_WORKFLOW_KINDS);
const nodeSchema = z.object({
  id: z.string().trim().min(1).max(64),
  type: z.literal('payroll'),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }),
  data: z.object({ kind: kindSchema }),
});
const edgeSchema = z.object({
  id: z.string().trim().min(1).max(64),
  source: z.string().trim().min(1).max(64),
  target: z.string().trim().min(1).max(64),
});

export const payrollWorkflowInputSchema = z.object({
  version: z.number().int().positive().safe(),
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(400),
}).superRefine((document, ctx) => {
  const nodeIds = new Set<string>();
  for (const node of document.nodes) {
    if (nodeIds.has(node.id)) ctx.addIssue({ code: 'custom', path: ['nodes'], message: `节点标识重复：${node.id}` });
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of document.edges) {
    if (edgeIds.has(edge.id)) ctx.addIssue({ code: 'custom', path: ['edges'], message: `连线标识重复：${edge.id}` });
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) ctx.addIssue({ code: 'custom', path: ['edges'], message: '连线指向不存在的节点' });
    if (edge.source === edge.target) ctx.addIssue({ code: 'custom', path: ['edges'], message: '节点不能连接自身' });
    const pair = `${edge.source}->${edge.target}`;
    if (pairs.has(pair)) ctx.addIssue({ code: 'custom', path: ['edges'], message: '不能重复连接相同节点' });
    pairs.add(pair);
  }
});

export function emptyWorkflow(): PayrollWorkflow {
  return { version: 1, nodes: [], edges: [] };
}

export function normalizeStoredWorkflow(value: unknown): PayrollWorkflow {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return emptyWorkflow(); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyWorkflow();
  const record = parsed as Record<string, unknown>;
  const version = typeof record.version === 'number' && Number.isSafeInteger(record.version) && record.version > 0 ? record.version : 1;
  const nodes: PayrollWorkflowNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of Array.isArray(record.nodes) ? record.nodes : []) {
    if (nodes.length >= 200) break;
    const node = nodeSchema.safeParse(raw);
    if (!node.success || nodeIds.has(node.data.id)) continue;
    nodeIds.add(node.data.id);
    nodes.push(node.data);
  }
  const edges: PayrollWorkflowEdge[] = [];
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const raw of Array.isArray(record.edges) ? record.edges : []) {
    if (edges.length >= 400) break;
    const edge = edgeSchema.safeParse(raw);
    if (!edge.success || edgeIds.has(edge.data.id) || !nodeIds.has(edge.data.source) || !nodeIds.has(edge.data.target) || edge.data.source === edge.data.target) continue;
    const pair = `${edge.data.source}->${edge.data.target}`;
    if (pairs.has(pair)) continue;
    edgeIds.add(edge.data.id);
    pairs.add(pair);
    edges.push(edge.data);
  }
  return { version, nodes, edges };
}

export async function readPayrollWorkflow(conn?: PoolConnection, lock = false): Promise<PayrollWorkflow> {
  const value = await findWorkflow(PAYROLL_WORKFLOW_KEY, conn, lock);
  return value === undefined ? emptyWorkflow() : normalizeStoredWorkflow(value);
}

export async function savePayrollWorkflow(input: PayrollWorkflow): Promise<PayrollWorkflow> {
  const fallback = await readPayrollWorkflow();
  return transaction(async conn => {
    await ensureWorkflow(conn, PAYROLL_WORKFLOW_KEY, fallback);
    const current = await readPayrollWorkflow(conn, true);
    if (current.version !== input.version) throw conflict('流程已被修改，请刷新后重试');
    const next = { version: current.version + 1, nodes: input.nodes, edges: input.edges };
    await updateWorkflow(conn, PAYROLL_WORKFLOW_KEY, next);
    return next;
  });
}
