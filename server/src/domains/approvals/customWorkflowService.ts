import { z } from 'zod';
import type { RowDataPacket } from 'mysql2';
import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import { badRequest, conflict } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';
import { validateWorkflowConditions, type WorkflowFieldPolicy } from './expenseWorkflowPolicy';
import { decryptWorkflowCredential, encryptWorkflowCredential } from './workflowCredentials';

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
    kind: z.enum(['form', 'start', 'verify', 'approver', 'branch', 'end', 'ai']),
    position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }),
    config: z.object({ approverIds: z.array(z.string().trim().min(1).max(10)).max(20).optional(), outcome: z.enum(['approved', 'rejected']).optional(), provider: z.enum(['deepseek', 'openai-compatible']).optional(), model: z.string().trim().max(150).optional(), baseUrl: z.string().trim().max(500).optional(), rules: z.string().max(10000).optional(), hasApiKey: z.boolean().optional() }).strict().optional(),
  })).max(200),
  edges: z.array(z.object({ id: identifier, source: identifier, target: identifier, conditions: z.array(condition).max(20).optional() })).max(400),
  credentialUpdates: z.array(z.object({ nodeId: identifier, apiKey: z.string().trim().min(1).max(2048) }).strict()).max(200).optional(),
});
export type CustomWorkflow = z.infer<typeof customWorkflowSchema>;

export function validateCustomWorkflowGraph(type: ApprovalApproverType, workflow: CustomWorkflow): void {
  const nodeIds = new Set(workflow.nodes.map(node => node.id));
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  if (nodeIds.size !== workflow.nodes.length) throw badRequest('节点编号重复');
  for (const node of workflow.nodes) {
    if (node.kind === 'ai' && type !== 'expense') throw badRequest('AI 审批节点仅支持报销');
    if (node.config?.approverIds && (node.kind !== 'approver' || new Set(node.config.approverIds).size !== node.config.approverIds.length)) throw badRequest('审批人配置无效');
    if (node.config?.outcome && node.kind !== 'end') throw badRequest('结束节点配置无效');
    if (node.kind !== 'ai' && node.config && ['provider', 'model', 'baseUrl', 'rules', 'hasApiKey'].some(key => key in node.config!)) throw badRequest('AI 审批节点配置无效');
    if (node.kind === 'ai' && node.config?.baseUrl) {
      try { const url = new URL(node.config.baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(); }
      catch { throw badRequest('请输入有效的模型接口地址'); }
    }
  }
  const updates = workflow.credentialUpdates ?? [];
  if (new Set(updates.map(item => item.nodeId)).size !== updates.length || updates.some(item => type !== 'expense' || !workflow.nodes.some(node => node.id === item.nodeId && node.kind === 'ai'))) throw badRequest('AI 节点凭据配置无效');
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
  if (type !== 'expense' || !parsed.data.nodes.some(node => node.kind === 'ai')) return parsed.data;
  const rows = await queryRows<{ node_id: string }>('SELECT node_id FROM custom_approval_credentials WHERE approval_type = ?', [type]);
  const ids = new Set(rows.map(item => item.node_id));
  return { ...parsed.data, nodes: parsed.data.nodes.map(node => node.kind === 'ai' ? { ...node, config: { ...node.config, hasApiKey: ids.has(node.id) } } : node) };
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
    const [credentialRows] = await conn.query<RowDataPacket[]>('SELECT node_id, encrypted_key FROM custom_approval_credentials WHERE approval_type = ?', [type]);
    const existing = new Set(credentialRows.map(row => String(row.node_id)));
    const aiIds = new Set(workflow.nodes.filter(node => node.kind === 'ai').map(node => node.id));
    if (workflow.credentialUpdates?.length && credentialRows.length) decryptWorkflowCredential(String(credentialRows[0].encrypted_key), String(credentialRows[0].node_id));
    for (const update of workflow.credentialUpdates ?? []) {
      const encrypted = encryptWorkflowCredential(update.apiKey, update.nodeId, existing.size === 0);
      await conn.execute('INSERT INTO custom_approval_credentials (approval_type, node_id, encrypted_key) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE encrypted_key = VALUES(encrypted_key)', [type, update.nodeId, encrypted]);
      existing.add(update.nodeId);
    }
    for (const id of existing) if (!aiIds.has(id)) { await conn.execute('DELETE FROM custom_approval_credentials WHERE approval_type = ? AND node_id = ?', [type, id]); existing.delete(id); }
    const nodes = workflow.nodes.map(node => {
      if (node.kind !== 'ai') return node;
      const { hasApiKey: _hasApiKey, ...config } = node.config ?? {};
      return { ...node, config };
    });
    const next = { version: workflow.version + 1, ...(hasExtendedData(workflow) ? { formFields: workflow.formFields ?? [] } : {}), nodes, edges: workflow.edges };
    await conn.execute('UPDATE custom_approval_workflows SET version = ?, graph_json = ?, updated_by = ?, updated_at = NOW() WHERE approval_type = ?', [next.version, JSON.stringify({ nodes: next.nodes, edges: next.edges, formFields: next.formFields }), adminId, type]);
    return { ...next, nodes: nodes.map(node => node.kind === 'ai' ? { ...node, config: { ...node.config, hasApiKey: existing.has(node.id) } } : node) };
  });
}
