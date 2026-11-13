import { config } from '../../../config';
import { invalidateU9QueryCache } from '../queryCache';
import { syncReceiptNotificationsFromMirror } from '../receiptNotificationService';
import { extractBusinessDateWindow, incrementalRange } from './extractWindow';
import { precomputeSummariesForBoundOperators } from './summaryPrecompute';
import {
  advanceWatermark,
  beginSyncRun,
  ensureSyncState,
  finishSyncRun,
  getSyncWatermark,
} from './writer';

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

function defaultSummaryRange(today: string): { from: string; to: string } {
  const [y] = today.split('-').map(Number);
  return { from: `${y}-01`, to: today.slice(0, 7) };
}

export async function runMirrorSync(mode: 'incremental' | 'nightly'): Promise<void> {
  if (running) {
    console.log('[u9-mirror] 已有同步在运行，跳过');
    return;
  }
  if (mode === 'incremental' && config.u9Mirror.skipHours.includes(currentHourLocal())) {
    console.log('[u9-mirror] 当前小时在跳过窗口，跳过增量');
    return;
  }

  running = true;
  await ensureSyncState();
  const runId = await beginSyncRun(mode);
  const today = todayLocal();
  try {
    const watermark = await getSyncWatermark();
    const range =
      mode === 'nightly'
        ? incrementalRange(null, today)
        : incrementalRange(watermark, today);
    const stats = await extractBusinessDateWindow(range.start, range.endExclusive);
    const summaryRange = defaultSummaryRange(today);
    const summaryRows = await precomputeSummariesForBoundOperators(
      summaryRange.from,
      summaryRange.to
    );
    const notices = await syncReceiptNotificationsFromMirror();
    await advanceWatermark(today, mode);
    invalidateU9QueryCache();
    await finishSyncRun(runId, true, undefined, { ...stats, summaryRows, notices });
    console.log('[u9-mirror] 同步成功', mode, { ...stats, summaryRows, notices });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun(runId, false, message.slice(0, 500));
    console.error('[u9-mirror] 同步失败，水位未前移', message);
    throw error;
  } finally {
    running = false;
  }
}
