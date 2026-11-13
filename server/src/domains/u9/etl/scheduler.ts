import { config } from '../../../config';
import { runMirrorSync } from './syncJob';

let incrementalTimer: NodeJS.Timeout | undefined;
let nightlyTimer: NodeJS.Timeout | undefined;
let lastNightlyKey = '';

function msUntilNextHour(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startU9MirrorScheduler(): void {
  if (!config.u9Mirror.etlEnabled) {
    console.log('[u9-mirror] ETL 未启用（U9_ETL_ENABLED!=true）');
    return;
  }

  const runIncremental = (): void => {
    void runMirrorSync('incremental').catch(() => undefined);
  };
  runIncremental();
  incrementalTimer = setInterval(runIncremental, Math.max(60000, config.u9Mirror.incrementalMs));
  incrementalTimer.unref();

  const armNightly = (): void => {
    nightlyTimer = setTimeout(() => {
      const key = new Date().toISOString().slice(0, 10);
      if (lastNightlyKey !== key) {
        lastNightlyKey = key;
        void runMirrorSync('nightly').catch(() => undefined);
      }
      armNightly();
    }, msUntilNextHour(config.u9Mirror.nightlyHour));
    nightlyTimer.unref();
  };
  armNightly();
  console.log(
    `[u9-mirror] 调度已启动 incrementalMs=${config.u9Mirror.incrementalMs} nightlyHour=${config.u9Mirror.nightlyHour}`
  );
}
