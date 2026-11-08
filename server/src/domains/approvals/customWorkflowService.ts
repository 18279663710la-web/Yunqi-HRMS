import { z } from 'zod';
import type { RowDataPacket } from 'mysql2';
import { queryOne, transaction } from '../../shared/db/pool';
import { badRequest, conflict } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';
import { validateWorkflowConditions, type WorkflowFieldPolicy } from './expenseWorkflowPolicy';

const TYPE_FIELDS: Record<ApprovalApproverType, WorkflowFieldPolicy> = {
  expense: { reserved: ['expenseType', 'amount', 'date', 'reason'], labels: ['报销类型', '报销金额（元）', '费用发生日期', '费用说明', '发票附件', '补充材料'], numericField: 'amount', choices: { expenseType: ['差旅费', '招待费', '办公用品', '交通费', '其他'] } },
  leave: { reserved: ['leaveType', 'startDate', 'startClock', 'endDate', 'endClock', 'days', 'reason'], labels: ['请假类型', '开始日期', '开始时间', '结束日期', '结束时间', '请假时长（天）', '请假事由'], numericField: 'days', choices: { leaveType: ['事假', '病假', '年假', '调休', '婚假', '产假'] } },
  overtime: { reserved: ['date', 'startTime', 'endTime', 'compensation', 'reason'], labels: ['加班日期', '开始时间', '结束时间', '补偿方式', '加班事由'], choices: {} },
  travel: { reserved: ['city', 'startDate', 'endDate', 'budget', 'reason'], labels: ['出差城市', '开始日期', '结束日期', '预算（元）', '出差事由'], numericField: 'budget', choices: {} },
  purchase: { reserved: ['item', 'amount', 'needDate', 'reason'], labels: ['采购物品', '预估金额（元）', '期望到货日期', '采购说明'], numericField: 'amount', choices: {} },
};

const identifier = z.string().min(1).max(100);
const condition = z.object({ field: z.string().min(1).max(40), operator: z.enum(['eq', 'gte', 'lt']), value: z.string().trim().min(1).max(100) });
export const customWorkflowSchema = z.object({
  version: z.number().int().min(0),
  formFields: z.array(z.object({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), label: z.string().trim().min(1).max(100), type: z.enum(['text', 'textarea', 'number', 'date', 'picker']), required: z.boolean(), options: z.array(z.string().trim().min(1).max(100)).max(50).optional() })).max(30).optional(),
  nodes: z.array(z.object({
    id: identifier,
    kind: z.enum(['form', 'start', 'verify', 'approver', 'branch', 'end']),
    position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }),
    config: z.object({ approverIds: z.array(z.string().trim().min(1).max(10)).max(20).optional(), outcome: z.enum(['approved', 'rejected']).optional() }).strict().optional(),
  })).max(200),
  edges: z.array(z.object({ id: identifier, source: identifier, target: identifier, conditions: z.array(condition).max(20).optional() })).max(400),
});
export type CustomWorkflow = z.infer<typeof customWorkflowSchema>;

export function validateCustomWorkflowGraph(type: ApprovalApproverType, workflow: CustomWorkflow): void {
  const nodeIds = new Set(workflow.nodes.map(node => node.id));
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  if (nodeIds.size !== workflow.nodes.length) throw badRequest('节点编号重复');
  for (const node of workflow.nodes) {
    if (node.config?.approverIds && (node.kind !== 'approver' || new Set(node.config.approverIds).size !== node.config.approverIds.length)) throw badRequest('审批人配置无效');
    if (node.config?.outcome && node.kind !== 'end') throw badRequest('结束节点配置无效');
  }
  for (const edge of workflow.edges) {
    const pair = JSON.stringify([edge.source, edge.target]);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target || pairs.has(pair) || edgeIds.has(edge.id)) throw badRequest('流程连线无效');
    if (edge.conditions?.length && workflow.nodes.find(node => node.id === edge.source)?.kind !== 'branch') throw badRequest('只有条件分支的连线可以设置条件');
    edgeIds.add(edge.id); pairs.add(pair);
  }
  const fields = workflow.formFields ?? [];
  const check = (branches: Array<{ conditions: z.infer<typeof condition>[]; approvers: string[] }>) => validateWorkflowConditions({ version: 1, enabled: false, fields, branches }, TYPE_FIELDS[type]);
  check([]);
  for (const node of workflow.nodes.filter(item => item.kind === 'branch')) {
    const branches = workflow.edges.filter(edge => edge.source === node.id && edge.conditions?.length).map(edge => ({ conditions: edge.conditions!, approvers: ['draft'] }));
    if (branches.length) check(branches);
  }
}

export async function readCustomWorkflow(type: ApprovalApproverType): Promise<CustomWorkflow> {
  const row = await queryOne<{ version: number; graph_json: string | object }>('SELECT version, graph_json FROM custom_approval_workflows WHERE approval_type = ?', [type]);
  if (!row) return { version: 0, nodes: [], edges: [] };
  const graph = typeof row.graph_json === 'string' ? JSON.parse(row.graph_json) as object : row.graph_json;
  const parsed = customWorkflowSchema.safeParse({ ...graph, version: Number(row.version) });
  if (!parsed.success) throw new Error('已保存的流程设计稿格式无效');
  validateCustomWorkflowGraph(type, parsed.data);
  return parsed.data;
}

export async function saveCustomWorkflow(type: ApprovalApproverType, workflow: CustomWorkflow, adminId: number): Promise<CustomWorkflow> {
  validateCustomWorkflowGraph(type, workflow);
  return transaction(async conn => {
    await conn.execute('INSERT IGNORE INTO custom_approval_workflows (approval_type, version, graph_json, updated_by, updated_at) VALUES (?, 0, ?, ?, NOW())', [type, JSON.stringify({ nodes: [], edges: [] }), adminId]);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT version, graph_json FROM custom_approval_workflows WHERE approval_type = ? FOR UPDATE', [type]);
    if (Number(rows[0].version) !== workflow.version) throw conflict('流程已被修改，请刷新后重试');
    const previous = typeof rows[0].graph_json === 'string' ? JSON.parse(rows[0].graph_json) : rows[0].graph_json;
    const hasExtendedData = (graph: { formFields?: unknown; nodes?: Array<{ kind?: string; config?: unknown }>; edges?: Array<{ conditions?: unknown }> }) =>
      graph.formFields !== undefined || graph.nodes?.some(node => node.config !== undefined || ['start', 'verify', 'end'].includes(node.kind || '')) || graph.edges?.some(edge => edge.conditions !== undefined);
    if (hasExtendedData(previous) && workflow.formFields === undefined) throw conflict('页面版本过旧，请刷新后重新编辑');
    const next = { ...workflow, ...(hasExtendedData(workflow) ? { formFields: workflow.formFields ?? [] } : {}), version: workflow.version + 1 };
    await conn.execute('UPDATE custom_approval_workflows SET version = ?, graph_json = ?, updated_by = ?, updated_at = NOW() WHERE approval_type = ?', [next.version, JSON.stringify({ nodes: next.nodes, edges: next.edges, formFields: next.formFields }), adminId, type]);
    return next;
  });
}
