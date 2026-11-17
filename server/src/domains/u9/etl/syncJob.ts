import { config } from '../../../config';
import { invalidateU9QueryCache } from '../queryCache';
import { syncReceiptNotificationsFromMirror } from '../receiptNotificationService';
import {
  extractBusinessDateWindow,
  extractDateRangeChunked,
  fullSyncRange,
  incrementalRange,
} from './extractWindow';
import { precomputeSummariesForBoundOperators } from './summaryPrecompute';
import {
  advanceWatermark,
  beginSyncRun,
  ensureSyncState,
  finishSyncRun,
  getLastSuccessAt,
  getSyncWatermark,
} from './writer';
import { logSystem } from '../../../shared/logging/logger';

let running = false;

function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentHourLocal(): number {
  return new Date().getHours();
}

export type MirrorSyncMode = 'bootstrap' | 'incremental' | 'nightly';

/**
 * - bootstrap：部署全量（U9 最早业务日 → 今天），按月切片；并刷汇总矩阵
 * - incremental：按水位回看增量；不刷汇总
 * - nightly：全量校对 + 汇总矩阵（每业务员 × 每个 from × to=当月）
 */
export async function runMirrorSync(mode: MirrorSyncMode): Promise<void> {
  if (running) {
    logSystem('u9', 'info', '已有同步在运行，跳过');
    return;
  }
  if (mode === 'incremental' && config.u9Mirror.skipHours.includes(currentHourLocal())) {
    logSystem('u9', 'info', '当前小时在跳过窗口，跳过增量');
    return;
  }

  running = true;
  await ensureSyncState();
  const runId = await beginSyncRun(mode);
  const today = todayLocal();
  try {
    let stats;
    let noticeSince: string;
    let summaryRows = 0;
    if (mode === 'incremental') {
      const watermark = await getSyncWatermark();
      const range = incrementalRange(watermark, today);
      stats = await extractBusinessDateWindow(range.start, range.endExclusive);
      noticeSince = range.start.slice(0, 7) + '-01';
    } else {
      const range = await fullSyncRange(today);
      logSystem('u9', 'info', `${mode} 全量范围`, { detail: JSON.stringify(range) });
      stats = await extractDateRangeChunked(range.start, range.endExclusive);
      noticeSince = range.start.slice(0, 7) + '-01';
      // 汇总 from 从全量起点所在年的 1 月起，避免选「2024-01」时因单据起点在年中而空表
      const summaryFrom = `${range.start.slice(0, 4)}-01`;
      const summaryTo = today.slice(0, 7);
      logSystem('u9', 'info', `${mode} 汇总矩阵`, { detail: JSON.stringify({ summaryFrom, summaryTo, docFrom: range.start.slice(0, 7) }) });
      summaryRows = await precomputeSummariesForBoundOperators(summaryFrom, summaryTo);
    }
    const notices = await syncReceiptNotificationsFromMirror({ since: noticeSince });
    await advanceWatermark(today, mode);
    invalidateU9QueryCache();
    await finishSyncRun(runId, true, undefined, { ...stats, summaryRows, notices, mode });
    logSystem('u9', 'info', `同步成功 ${mode}`, { detail: JSON.stringify({ ...stats, summaryRows, notices }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun(runId, false, message.slice(0, 500));
    logSystem('u9', 'error', `同步失败，水位未前移：${message}`);
    throw error;
  } finally {
    running = false;
  }
}

/** 尚无成功同步时执行部署全量；已有数据则跳过。 */
export async function runBootstrapIfNeeded(): Promise<boolean> {
  await ensureSyncState();
  const last = await getLastSuccessAt();
  if (last) {
    logSystem('u9', 'info', '已有成功同步，跳过启动全量', { detail: String(last) });
    return false;
  }
  logSystem('u9', 'info', '无成功同步记录，开始部署全量');
  await runMirrorSync('bootstrap');
  return true;
}
