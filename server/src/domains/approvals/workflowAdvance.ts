import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

/** 在已锁定审批单的事务中，将下一个等待节点设为当前节点。 */
export async function advanceWorkflowTimeline(conn: PoolConnection, approvalId: string, currentStep: number, now: string): Promise<{ finished: boolean; message: string }> {
  let previousStep = currentStep;
  for (;;) {
    const [nextRows] = await conn.query<RowDataPacket[]>("SELECT * FROM approval_timeline WHERE approval_id = ? AND step_no > ? AND state = 'wait' ORDER BY step_no LIMIT 1 FOR UPDATE", [approvalId, previousStep]);
    const next = nextRows[0];
    if (!next) break;
    if (next.role === '系统查验') {
      await conn.query("UPDATE approval_timeline SET state = 'done', action = '查验通过', time_text = ? WHERE id = ?", [now, next.id]);
      previousStep = Number(next.step_no);
      continue;
    }
    const isAi = next.role === 'AI 审批';
    if (isAi) {
      const [result] = await conn.execute<import('mysql2').ResultSetHeader>("UPDATE approval_workflow_ai_jobs SET status = 'queued', updated_at = NOW() WHERE approval_id = ? AND step_no = ? AND status = 'waiting'", [approvalId, next.step_no]);
      if (result.affectedRows !== 1) throw new Error('AI 审批节点状态无效');
    }
    await conn.query('UPDATE approval_timeline SET state = ?, action = ? WHERE id = ?', ['current', isAi ? '处理中' : '审批中', next.id]);
    await conn.query('UPDATE approvals SET status = ?, node = ?, updated_at = ? WHERE id = ?', ['pending', isAi ? 'AI 审批中' : `${next.name} 审批中`, now, approvalId]);
    return { finished: false, message: isAi ? '已同意，流转至 AI 审批' : `已同意，流转至${next.name}` };
  }
  const [instances] = await conn.query<RowDataPacket[]>('SELECT outcome FROM approval_workflow_instances WHERE approval_id = ?', [approvalId]);
  const outcome = instances[0]?.outcome === 'rejected' ? 'rejected' : 'approved';
  await conn.query('UPDATE approvals SET status = ?, node = ?, updated_at = ? WHERE id = ?', [outcome, outcome === 'rejected' ? '已驳回' : '已通过', now, approvalId]);
  return { finished: true, message: outcome === 'rejected' ? '流程已结束，申请已驳回' : '已同意' };
}
