import type { RowDataPacket } from 'mysql2';
import { execute, queryOne, queryRows, transaction } from '../../shared/db/pool';
import { badRequest } from '../../shared/utils/errors';
import { formatTime } from '../../shared/utils/datetime';
import type { CurrentUser } from '../../shared/types/models';
import { classifyAiError, type AiAdvice } from './expenseAiPolicy';
import { generateExpenseAdvice, type AiInput } from './expenseAiService';
import { decryptWorkflowCredential } from './workflowCredentials';
import { advanceWorkflowTimeline } from './workflowAdvance';
import type { CustomWorkflow } from './customWorkflowService';

interface JobRow {
  approval_id: string; step_no: number; node_id: string; status: string; attempts: number;
  input_json: string | AiInput; workflow_json: string | CustomWorkflow; credentials_json: string | Record<string, string>;
}
function json<T>(value: string | T): T { return typeof value === 'string' ? JSON.parse(value) as T : value; }
let busy = false;

async function recoverStaleJobs(): Promise<void> {
  const stale = await queryRows<{ approval_id: string; step_no: number }>("SELECT approval_id, step_no FROM approval_workflow_ai_jobs WHERE status = 'processing' AND updated_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE) ORDER BY updated_at LIMIT 50");
  for (const item of stale) await transaction(async conn => {
    const [approval] = await conn.query<RowDataPacket[]>('SELECT status FROM approvals WHERE id = ? FOR UPDATE', [item.approval_id]);
    const [jobs] = await conn.query<RowDataPacket[]>("SELECT attempts FROM approval_workflow_ai_jobs WHERE approval_id = ? AND step_no = ? AND status = 'processing' AND updated_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE) FOR UPDATE", [item.approval_id, item.step_no]);
    if (!jobs.length) return;
    const [current] = await conn.query<RowDataPacket[]>("SELECT id FROM approval_timeline WHERE approval_id = ? AND step_no = ? AND state = 'current' AND role = 'AI 审批' FOR UPDATE", [item.approval_id, item.step_no]);
    if (!approval.length || approval[0].status !== 'pending' || !current.length) {
      await conn.execute("UPDATE approval_workflow_ai_jobs SET status = 'stopped', updated_at = NOW() WHERE approval_id = ? AND step_no = ?", [item.approval_id, item.step_no]);
      return;
    }
    const failed = Number(jobs[0].attempts) >= 3;
    await conn.execute('UPDATE approval_workflow_ai_jobs SET status = ?, updated_at = NOW() WHERE approval_id = ? AND step_no = ?', [failed ? 'failed' : 'queued', item.approval_id, item.step_no]);
    if (failed) {
      await conn.execute("UPDATE approval_timeline SET action = 'AI 审批失败，等待重试' WHERE approval_id = ? AND step_no = ? AND state = 'current'", [item.approval_id, item.step_no]);
      await conn.execute("UPDATE approvals SET node = 'AI 审批失败', updated_at = NOW() WHERE id = ?", [item.approval_id]);
    }
  });
}

export async function processWorkflowAiQueue(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await recoverStaleJobs();
    const job = await queryOne<JobRow>(`SELECT j.*, i.workflow_json, i.credentials_json FROM approval_workflow_ai_jobs j
      JOIN approval_workflow_instances i ON i.approval_id = j.approval_id
      JOIN approvals a ON a.id = j.approval_id AND a.status = 'pending'
      JOIN approval_timeline t ON t.approval_id = j.approval_id AND t.step_no = j.step_no AND t.state = 'current' AND t.role = 'AI 审批'
      WHERE j.status = 'queued' ORDER BY j.created_at, j.approval_id, j.step_no LIMIT 1`);
    if (!job) return;
    const claimed = await execute(`UPDATE approval_workflow_ai_jobs j SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
      WHERE j.approval_id = ? AND j.step_no = ? AND j.status = 'queued' AND EXISTS
      (SELECT 1 FROM approvals a JOIN approval_timeline t ON t.approval_id = a.id WHERE a.id = j.approval_id AND a.status = 'pending' AND t.step_no = j.step_no AND t.state = 'current' AND t.role = 'AI 审批')`, [job.approval_id, job.step_no]);
    if (!claimed.affectedRows) return;
    try {
      const workflow = json(job.workflow_json);
      const credentials = json(job.credentials_json);
      const node = workflow.nodes.find(item => item.id === job.node_id && item.kind === 'ai');
      const config = node?.config;
      const encrypted = credentials[job.node_id];
      if (!config?.provider || !config.model || !config.baseUrl || !config.rules || !encrypted) throw new Error('AI 节点快照无效');
      const advice = await generateExpenseAdvice(json(job.input_json), config.rules, { modelSettings: { provider: config.provider, model: config.model, baseUrl: config.baseUrl, apiKey: decryptWorkflowCredential(encrypted, job.node_id) } });
      if (!advice.recommendation) throw new Error('AI 建议未生成');
      await transaction(async conn => {
        const [approval] = await conn.query<RowDataPacket[]>('SELECT status FROM approvals WHERE id = ? FOR UPDATE', [job.approval_id]);
        const [jobs] = await conn.query<RowDataPacket[]>('SELECT status FROM approval_workflow_ai_jobs WHERE approval_id = ? AND step_no = ? FOR UPDATE', [job.approval_id, job.step_no]);
        if (!approval.length || approval[0].status !== 'pending' || jobs[0]?.status !== 'processing') return;
        const [timeline] = await conn.query<RowDataPacket[]>("SELECT id FROM approval_timeline WHERE approval_id = ? AND step_no = ? AND state = 'current' AND role = 'AI 审批' FOR UPDATE", [job.approval_id, job.step_no]);
        if (!timeline.length) throw new Error('AI 审批节点状态无效');
        const now = formatTime(new Date(), 'YYYY-MM-DD HH:mm');
        await conn.execute("UPDATE approval_workflow_ai_jobs SET status = 'completed', result_json = ?, updated_at = NOW() WHERE approval_id = ? AND step_no = ?", [JSON.stringify(advice), job.approval_id, job.step_no]);
        await conn.execute("UPDATE approval_timeline SET state = 'done', action = '已生成建议', time_text = ? WHERE id = ?", [now, timeline[0].id]);
        await advanceWorkflowTimeline(conn, job.approval_id, job.step_no, now);
      });
    } catch (error) {
      console.error(`[workflow-ai] 生成失败：${classifyAiError(error)}`);
      await transaction(async conn => {
        const [approval] = await conn.query<RowDataPacket[]>('SELECT status FROM approvals WHERE id = ? FOR UPDATE', [job.approval_id]);
        const [jobs] = await conn.query<RowDataPacket[]>('SELECT status, attempts FROM approval_workflow_ai_jobs WHERE approval_id = ? AND step_no = ? FOR UPDATE', [job.approval_id, job.step_no]);
        if (!approval.length || approval[0].status !== 'pending' || jobs[0]?.status !== 'processing') return;
        const failed = Number(jobs[0].attempts) >= 3;
        await conn.execute('UPDATE approval_workflow_ai_jobs SET status = ?, updated_at = NOW() WHERE approval_id = ? AND step_no = ?', [failed ? 'failed' : 'queued', job.approval_id, job.step_no]);
        if (failed) {
          await conn.execute("UPDATE approval_timeline SET action = 'AI 审批失败，等待重试' WHERE approval_id = ? AND step_no = ? AND state = 'current'", [job.approval_id, job.step_no]);
          await conn.execute("UPDATE approvals SET node = 'AI 审批失败', updated_at = NOW() WHERE id = ?", [job.approval_id]);
        }
      });
    }
  } finally { busy = false; }
}

export async function retryWorkflowAi(approvalId: string, user: CurrentUser): Promise<{ ok: true }> {
  return transaction(async conn => {
    const [approvals] = await conn.query<RowDataPacket[]>('SELECT applicant_id, status FROM approvals WHERE id = ? FOR UPDATE', [approvalId]);
    if (!approvals.length || approvals[0].status !== 'pending') throw badRequest('审批单不可重试');
    const [participants] = await conn.query<RowDataPacket[]>('SELECT 1 FROM approval_timeline WHERE approval_id = ? AND approver_id = ? LIMIT 1', [approvalId, user.id]);
    if (approvals[0].applicant_id !== user.id && !participants.length) throw badRequest('无权重试该审批');
    const [current] = await conn.query<RowDataPacket[]>("SELECT step_no FROM approval_timeline WHERE approval_id = ? AND state = 'current' AND role = 'AI 审批' FOR UPDATE", [approvalId]);
    if (!current.length) throw badRequest('当前没有可重试的 AI 审批');
    const [updated] = await conn.execute<import('mysql2').ResultSetHeader>("UPDATE approval_workflow_ai_jobs SET status = 'queued', attempts = 0, updated_at = NOW() WHERE approval_id = ? AND step_no = ? AND status = 'failed'", [approvalId, current[0].step_no]);
    if (!updated.affectedRows) throw badRequest('当前没有可重试的 AI 审批');
    await conn.execute("UPDATE approval_timeline SET action = '处理中' WHERE approval_id = ? AND step_no = ?", [approvalId, current[0].step_no]);
    await conn.execute("UPDATE approvals SET node = 'AI 审批中', updated_at = NOW() WHERE id = ?", [approvalId]);
    return { ok: true };
  });
}

export async function getWorkflowAiState(approvalId: string, isParticipant: boolean, isApprover: boolean): Promise<{ aiAdvice: { status: string; advice: AiAdvice | null } | null; aiRetryAvailable: boolean; workflowAiStatus: string | null }> {
  if (!isParticipant) return { aiAdvice: null, aiRetryAvailable: false, workflowAiStatus: null };
  const current = await queryOne<{ status: string }>(`SELECT j.status FROM approval_workflow_ai_jobs j JOIN approval_timeline t ON t.approval_id = j.approval_id AND t.step_no = j.step_no
    WHERE j.approval_id = ? AND t.state = 'current' LIMIT 1`, [approvalId]);
  const completed = isApprover ? await queryOne<{ result_json: string | AiAdvice }>("SELECT result_json FROM approval_workflow_ai_jobs WHERE approval_id = ? AND status = 'completed' ORDER BY step_no DESC LIMIT 1", [approvalId]) : null;
  return { aiAdvice: completed?.result_json ? { status: 'completed', advice: json(completed.result_json) } : null, aiRetryAvailable: current?.status === 'failed', workflowAiStatus: current?.status ?? null };
}

export function startWorkflowAiWorker(): void {
  const run = (): void => { void processWorkflowAiQueue().catch(() => console.error('[workflow-ai] 任务处理失败')); };
  run();
  setInterval(run, 5000).unref();
}
