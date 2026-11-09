import { probeWorkflowAiUrl, type WorkflowAiUrlProbeResult } from './workflowAiUrlProbe';
import type { ApprovalApproverType } from './expenseApproverService';
import type { CustomWorkflow } from './customWorkflowService';

type WorkflowNode = CustomWorkflow['nodes'][number];
type WorkflowEdge = CustomWorkflow['edges'][number];
export interface WorkflowSimulationResult {
  passed: boolean;
  path: string[];
  approverIds: string[];
  outcome?: 'approved' | 'rejected';
  error?: string;
}

/** 发布前检查所有节点及连线，设计稿保存仍允许未完成的画布。 */
export function validateExecutableWorkflow(type: ApprovalApproverType, workflow: CustomWorkflow): string[] {
  const errors: string[] = [];
  const nodeMap = new Map(workflow.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, number>();
  for (const edge of workflow.edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) { errors.push('流程存在无效连线'); continue; }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const starts = workflow.nodes.filter(node => node.kind === 'start');
  if (starts.length !== 1) errors.push('流程必须有且只有一个发起人节点');
  if (!workflow.nodes.some(node => node.kind === 'end')) errors.push('流程至少需要一个结束节点');
  for (const node of workflow.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (node.kind === 'start' && (incoming.get(node.id) ?? 0) !== 0) errors.push('发起人节点不能有进入连线');
    if (node.kind === 'end' && edges.length) errors.push('结束节点不能有后续连线');
    if (node.kind === 'branch' && (!edges.length || edges.some(edge => !edge.conditions?.length))) errors.push('条件分支的每条连线都须配置条件');
    if (!['branch', 'end'].includes(node.kind) && edges.length !== 1) errors.push('非分支节点必须连接一个后续节点');
    if (node.kind === 'approver' && !node.config?.approverIds?.length) errors.push('审批人节点未配置审批人');
    if (node.kind === 'ai' && (type !== 'expense' || !node.config?.provider || !node.config.model?.trim() || !node.config.baseUrl?.trim() || !node.config.rules?.trim() || !node.config.hasApiKey)) errors.push('AI 审批节点配置不完整');
    if (node.kind === 'verify' && type !== 'expense') errors.push('系统查验节点仅支持报销');
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { errors.push('流程不能包含循环'); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) ?? []) visit(edge.target);
    visiting.delete(id);
    visited.add(id);
  };
  if (starts[0]) visit(starts[0].id);
  if (workflow.nodes.some(node => !visited.has(node.id))) errors.push('流程存在未连接到发起人的节点');
  const humanPathCache = new Map<string, boolean>();
  const reachesHumanOnEveryPath = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    const cached = humanPathCache.get(id);
    if (cached !== undefined) return cached;
    const node = nodeMap.get(id);
    if (!node) return false;
    if (node.kind === 'approver') return !!node.config?.approverIds?.length;
    if (node.kind === 'end') return false;
    const next = outgoing.get(id) ?? [];
    const result = next.length > 0 && next.every(edge => reachesHumanOnEveryPath(edge.target, new Set([...seen, id])));
    humanPathCache.set(id, result);
    return result;
  };
  if (type === 'expense' && starts[0] && !reachesHumanOnEveryPath(starts[0].id, new Set())) errors.push('报销流程每条路径都必须经过人工审批');
  for (const node of workflow.nodes.filter(item => item.kind === 'ai')) {
    const next = outgoing.get(node.id) ?? [];
    if (!next.length || !next.every(edge => reachesHumanOnEveryPath(edge.target, new Set([node.id])))) errors.push('AI 审批节点之后必须经过人工审批');
  }
  return [...new Set(errors)];
}

function matches(edge: WorkflowEdge, values: Record<string, string>): boolean {
  return !!edge.conditions?.length && edge.conditions.every(condition => {
    const value = Object.prototype.hasOwnProperty.call(values, condition.field) ? String(values[condition.field]).trim() : '';
    if (condition.operator === 'eq') return value === condition.value;
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
    const number = Number(value);
    const threshold = Number(condition.value);
    return Number.isFinite(number) && Number.isFinite(threshold) && (condition.operator === 'gte' ? number >= threshold : number < threshold);
  });
}

/** 仅计算路径，不调用模型、不写入审批单或发票。 */
export function simulateApprovalWorkflow(workflow: CustomWorkflow, values: Record<string, string>): WorkflowSimulationResult {
  const path: string[] = [];
  const approverIds: string[] = [];
  const nodeMap = new Map<string, WorkflowNode>(workflow.nodes.map(node => [node.id, node]));
  let node = workflow.nodes.find(item => item.kind === 'start');
  while (node) {
    if (path.includes(node.id)) return { passed: false, path, approverIds, error: '流程存在循环' };
    path.push(node.id);
    if (node.kind === 'approver') approverIds.push(...(node.config?.approverIds ?? []));
    if (node.kind === 'end') return { passed: true, path, approverIds, outcome: node.config?.outcome ?? 'approved' };
    const outgoing = workflow.edges.filter(edge => edge.source === node!.id);
    const matching = node.kind === 'branch' ? outgoing.filter(edge => matches(edge, values)) : outgoing;
    if (!matching.length) return { passed: false, path, approverIds, error: node.kind === 'branch' ? '条件分支未匹配' : '流程未连接到结束节点' };
    if (matching.length !== 1) return { passed: false, path, approverIds, error: '流程存在多条匹配连线' };
    node = nodeMap.get(matching[0].target);
  }
  return { passed: false, path, approverIds, error: '流程缺少发起人或有效节点' };
}

export interface WorkflowTestCase { name: string; values: Record<string, string> }
export interface WorkflowTestReport {
  passed: boolean;
  errors: string[];
  cases: Array<WorkflowSimulationResult & { name: string }>;
  aiChecks: Array<{ nodeId: string; reachable: boolean; status?: number }>;
}

/** 测试不执行审批或模型调用；AI 节点只检查所配置地址是否返回 HTTP 响应。 */
export async function runWorkflowTests(
  type: ApprovalApproverType,
  workflow: CustomWorkflow,
  cases: WorkflowTestCase[],
  probe: (url: string) => Promise<WorkflowAiUrlProbeResult> = probeWorkflowAiUrl,
): Promise<WorkflowTestReport> {
  const errors = validateExecutableWorkflow(type, workflow);
  if (!cases.length) errors.push('请至少配置一条测试用例');
  if (errors.length) return { passed: false, errors, cases: [], aiChecks: [] };
  const aiNodes = workflow.nodes.filter(node => node.kind === 'ai');
  const urls = [...new Set(aiNodes.map(node => node.config!.baseUrl!))];
  const checks = new Map<string, WorkflowAiUrlProbeResult>();
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (index < urls.length) {
      const url = urls[index++];
      try { checks.set(url, await probe(url)); } catch { checks.set(url, { reachable: false }); }
    }
  }));
  const aiChecks = aiNodes.map(node => ({ nodeId: node.id, ...(checks.get(node.config!.baseUrl!) ?? { reachable: false }) }));
  const results = cases.map(item => ({ name: item.name, ...simulateApprovalWorkflow(workflow, item.values) }));
  return { passed: aiChecks.every(item => item.reachable) && results.every(item => item.passed), errors, cases: results, aiChecks };
}
