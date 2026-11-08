import { z } from 'zod';
import type { RowDataPacket } from 'mysql2';
import { queryOne, transaction } from '../../shared/db/pool';
import { badRequest, conflict } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';

const identifier = z.string().min(1).max(100);
export const customWorkflowSchema = z.object({
  version: z.number().int().min(0),
  nodes: z.array(z.object({
    id: identifier,
    kind: z.enum(['form', 'approver', 'branch']),
    position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }),
  })).max(200),
  edges: z.array(z.object({ id: identifier, source: identifier, target: identifier })).max(400),
});
export type CustomWorkflow = z.infer<typeof customWorkflowSchema>;

function validateGraph(workflow: CustomWorkflow): void {
  const nodeIds = new Set(workflow.nodes.map(node => node.id));
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  if (nodeIds.size !== workflow.nodes.length) throw badRequest('节点编号重复');
  for (const edge of workflow.edges) {
    const pair = JSON.stringify([edge.source, edge.target]);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target || pairs.has(pair) || edgeIds.has(edge.id)) throw badRequest('流程连线无效');
    edgeIds.add(edge.id); pairs.add(pair);
  }
}

export async function readCustomWorkflow(type: ApprovalApproverType): Promise<CustomWorkflow> {
  const row = await queryOne<{ version: number; graph_json: string | { nodes: CustomWorkflow['nodes']; edges: CustomWorkflow['edges'] } }>('SELECT version, graph_json FROM custom_approval_workflows WHERE approval_type = ?', [type]);
  if (!row) return { version: 0, nodes: [], edges: [] };
  const graph = typeof row.graph_json === 'string' ? JSON.parse(row.graph_json) as object : row.graph_json;
  const parsed = customWorkflowSchema.safeParse({ ...graph, version: Number(row.version) });
  if (!parsed.success) throw new Error('已保存的流程设计稿格式无效');
  validateGraph(parsed.data);
  return parsed.data;
}

export async function saveCustomWorkflow(type: ApprovalApproverType, workflow: CustomWorkflow, adminId: number): Promise<CustomWorkflow> {
  validateGraph(workflow);
  return transaction(async conn => {
    await conn.execute('INSERT IGNORE INTO custom_approval_workflows (approval_type, version, graph_json, updated_by, updated_at) VALUES (?, 0, ?, ?, NOW())', [type, JSON.stringify({ nodes: [], edges: [] }), adminId]);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT version FROM custom_approval_workflows WHERE approval_type = ? FOR UPDATE', [type]);
    if (Number(rows[0].version) !== workflow.version) throw conflict('流程已被修改，请刷新后重试');
    const next = { ...workflow, version: workflow.version + 1 };
    await conn.execute('UPDATE custom_approval_workflows SET version = ?, graph_json = ?, updated_by = ?, updated_at = NOW() WHERE approval_type = ?', [next.version, JSON.stringify({ nodes: next.nodes, edges: next.edges }), adminId, type]);
    return next;
  });
}
