import { badRequest } from '../../shared/utils/errors';
import type { ApprovalApproverType } from './expenseApproverService';
import type { CustomWorkflow } from './customWorkflowService';
import { simulateApprovalWorkflow, validateExecutableWorkflow } from './customWorkflowSimulation';

export type WorkflowExecutionStep = { kind: 'ai'; nodeId: string } | { kind: 'verify'; nodeId: string; checkDuplicate: boolean; verifyInvoice: boolean } | { kind: 'approver'; nodeId: string; approverId: string };
export interface WorkflowExecutionPlan { steps: WorkflowExecutionStep[]; outcome: 'approved' | 'rejected' }

/** 路径上没有查验节点，或节点未写开关时，查重和验伪都做。任一查验节点打开某项，该项就做。 */
export function expenseVerificationSelection(steps: Array<{ kind: string; checkDuplicate?: boolean; verifyInvoice?: boolean }>): { checkDuplicate: boolean; verifyInvoice: boolean } {
  const verify = steps.filter(step => step.kind === 'verify');
  if (!verify.length) return { checkDuplicate: true, verifyInvoice: true };
  return {
    checkDuplicate: verify.some(step => step.checkDuplicate !== false),
    verifyInvoice: verify.some(step => step.verifyInvoice !== false),
  };
}

/** 依据已发布版本及申请字段固定路径；调用方负责保存快照与处理节点。 */
export function planWorkflowExecution(type: ApprovalApproverType, workflow: CustomWorkflow, values: Record<string, string>): WorkflowExecutionPlan {
  const errors = validateExecutableWorkflow(type, workflow);
  if (errors.length) throw badRequest('审批流程配置无效，请联系管理员');
  const result = simulateApprovalWorkflow(workflow, values);
  if (!result.passed || !result.outcome) throw badRequest(result.error === '条件分支未匹配' ? '申请未匹配审批流程，请联系管理员配置' : '审批流程配置无效，请联系管理员');
  const nodes = new Map(workflow.nodes.map(node => [node.id, node]));
  const steps: WorkflowExecutionStep[] = [];
  for (const id of result.path) {
    const node = nodes.get(id)!;
    if (node.kind === 'verify') steps.push({ kind: 'verify', nodeId: id, checkDuplicate: node.config?.checkDuplicate !== false, verifyInvoice: node.config?.verifyInvoice !== false });
    else if (node.kind === 'ai') steps.push({ kind: 'ai', nodeId: id });
    if (node.kind === 'approver') for (const approverId of node.config?.approverIds ?? []) steps.push({ kind: 'approver', nodeId: id, approverId });
  }
  return { steps, outcome: result.outcome };
}
