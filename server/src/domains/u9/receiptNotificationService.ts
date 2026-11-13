import { config } from '../../config';
import { execute, queryOne, queryRows } from '../../shared/db/pool';
import { mirrorU9 } from './mirrorGateway';
import { sqlServerU9 } from './sqlServerGateway';
import type { U9Gateway } from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function syncStart(): Promise<string> {
  const existing = await queryOne<{ started_at: string }>(
    "SELECT DATE_FORMAT(started_at,'%Y-%m-%d') started_at FROM u9_receipt_sync WHERE id=1"
  );
  if (existing) return existing.started_at;
  if (DATE_PATTERN.test(config.u9ReceiptNotify.since)) {
    await execute('INSERT IGNORE INTO u9_receipt_sync (id,started_at,updated_at) VALUES (1,?,NOW())', [config.u9ReceiptNotify.since]);
  } else {
    await execute('INSERT IGNORE INTO u9_receipt_sync (id,started_at,updated_at) VALUES (1,CURDATE(),NOW())');
  }
  const created = await queryOne<{ started_at: string }>(
    "SELECT DATE_FORMAT(started_at,'%Y-%m-%d') started_at FROM u9_receipt_sync WHERE id=1"
  );
  return created?.started_at || config.u9ReceiptNotify.since || new Date().toISOString().slice(0, 10);
}

async function effectiveSince(startedAt: string, override?: string): Promise<string> {
  if (override && DATE_PATTERN.test(override)) return override;
  const lookbackDays = Math.max(1, config.u9ReceiptNotify.lookbackDays);
  const row = await queryOne<{ since_date: string }>(
    `SELECT DATE_FORMAT(GREATEST(?, DATE_SUB(CURDATE(), INTERVAL ${lookbackDays} DAY)), '%Y-%m-%d') since_date`,
    [startedAt]
  );
  return row?.since_date || startedAt;
}

async function bindingsByOperator(): Promise<Map<string, string>> {
  const rows = await queryRows<{ operator_id: string; employee_id: string }>(
    `SELECT b.operator_id, b.employee_id
     FROM u9_employee_bindings b
     JOIN employees e ON e.id=b.employee_id
     WHERE e.position='业务员'
       AND NOT EXISTS (SELECT 1 FROM hr_employee_departures d WHERE d.employee_id=e.id AND d.status='departed')`
  );
  return new Map(rows.map(row => [row.operator_id, row.employee_id]));
}

/**
 * 拉取 U9 已审核及之后的收款单，按业务员绑定生成回款留单。
 * 返回本次新增的通知数；重复轮询依赖唯一键去重。
 */
export async function syncReceiptNotifications(
  u9: Pick<U9Gateway, 'listReceiptsForNotification'> = sqlServerU9,
  options: { since?: string } = {}
): Promise<number> {
  const startedAt = await syncStart();
  const since = await effectiveSince(startedAt, options.since);
  const receipts = await u9.listReceiptsForNotification(since, config.u9ReceiptNotify.orgCode);
  let inserted = 0;
  if (receipts.length) {
    const bindings = await bindingsByOperator();
    for (const receipt of receipts) {
      const employeeId = bindings.get(receipt.transactorId);
      if (!employeeId) continue;
      const result = await execute(
        `INSERT IGNORE INTO receipt_notifications
          (u9_receipt_id,employee_id,operator_id,doc_no,customer_name,business_date,total_amount,org_name,lines_json,line_count,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
        [
          receipt.id, employeeId, receipt.transactorId, receipt.docNo, receipt.customerName,
          receipt.businessDate.slice(0, 10), receipt.totalAmount, receipt.orgName,
          JSON.stringify(receipt.lines), receipt.lines.length,
        ]
      );
      inserted += result.affectedRows;
    }
  }
  await execute('UPDATE u9_receipt_sync SET last_poll_at=NOW(), updated_at=NOW() WHERE id=1');
  if (inserted) console.log(`[u9-receipt] 新增 ${inserted} 条回款通知`);
  return inserted;
}

/** 从 MySQL 镜像留单；供 ETL 成功后调用，不再高频直连 U9。 */
export async function syncReceiptNotificationsFromMirror(
  options: { since?: string } = {}
): Promise<number> {
  return syncReceiptNotifications(mirrorU9, options);
}

let busy = false;

export async function processReceiptNotificationQueue(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    // ETL 未启用时保留旧轮询直连；启用镜像后仅读镜像补漏，避免打主库。
    if (config.u9Mirror.etlEnabled) {
      await syncReceiptNotificationsFromMirror();
    } else {
      await syncReceiptNotifications(sqlServerU9);
    }
  } finally {
    busy = false;
  }
}

export function startReceiptNotificationWorker(): void {
  // 镜像 ETL 开启后，主路径由抽取任务留单；此处仅作低频补漏（拉长间隔）。
  const pollMs = config.u9Mirror.etlEnabled
    ? Math.max(config.u9ReceiptNotify.pollMs, config.u9Mirror.incrementalMs)
    : Math.max(5000, config.u9ReceiptNotify.pollMs);
  const run = (): void => {
    void processReceiptNotificationQueue().catch(error =>
      console.error('[u9-receipt] 回款通知同步失败', error instanceof Error ? error.message : error)
    );
  };
  run();
  setInterval(run, pollMs).unref();
}
