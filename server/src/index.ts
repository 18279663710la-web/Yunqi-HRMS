import fs from 'node:fs';

import { createApp } from './app';
import { config } from './config';
import { ensureDatabase, ensureSchema } from './shared/db/pool';
import { seedDatabase } from './shared/db/seed';
import { seedAttendanceIfEmpty } from './shared/db/attendanceSeed';
import { migrateVisitQuickAction } from './shared/db/quickActionMigration';
import { ensureDefaultAdmin } from './admin/admin-accounts/adminAuthService';
import { backfillEmployeeJobCategories } from './admin/employees/adminEmployeeService';
import { startExpenseAiWorker } from './domains/approvals/expenseAiService';
import { startWorkflowAiWorker } from './domains/approvals/workflowAiWorker';
import { startReceiptNotificationWorker } from './domains/u9/receiptNotificationService';
import { startU9MirrorScheduler } from './domains/u9/etl/scheduler';
import { getU9QuerySource } from './domains/u9/createGateway';
import { getLastSuccessAt } from './domains/u9/etl/writer';
import { backfillJobTitles } from './domains/employees/jobTitleService';
import { migrateOrganizations } from './domains/employees/organizationService';
import { logSystem, startLogMaintenance } from './shared/logging/logger';

async function bootstrap(): Promise<void> {
  fs.mkdirSync(config.uploadDir, { recursive: true });

  if (config.autoMigrate) {
    await ensureDatabase();
    await ensureSchema();
    const seeded = await seedDatabase(false);
    if (seeded) logSystem('db', 'info', '首次启动：已写入演示数据');
    const attendanceSeeded = await seedAttendanceIfEmpty();
    if (attendanceSeeded) logSystem('db', 'info', '已生成演示考勤记录');
    const adminSeeded = await ensureDefaultAdmin();
    if (adminSeeded) logSystem('server', 'info', '已创建默认管理员');
    const backfilled = await backfillEmployeeJobCategories();
    if (backfilled) logSystem('db', 'info', `已补齐 ${backfilled} 名员工的职位分类`);
    await backfillJobTitles();
    await migrateOrganizations();
    await migrateVisitQuickAction();
  }

  const app = createApp();
  startLogMaintenance();
  startExpenseAiWorker();
  startWorkflowAiWorker();
  startU9MirrorScheduler();
  startReceiptNotificationWorker();
  const u9Source = getU9QuerySource();
  if (u9Source === 'mysql') {
    const lastSync = await getLastSuccessAt();
    if (!lastSync) {
      logSystem('u9', 'warn', 'U9_QUERY_SOURCE=mysql 但尚无成功同步，业务查询可能为空；请先启用 U9_ETL_ENABLED 完成抽取');
    }
  }
  app.listen(config.port, '0.0.0.0', () => {
    logSystem('server', 'info', `http://127.0.0.1:${config.port}`);
    logSystem('db', 'info', `${config.mysql.user}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
    logSystem('server', 'info', `ocr driver=${config.ocrDriver}  verify driver=${config.verifyDriver}`);
    logSystem('u9', 'info', `querySource=${u9Source} etlEnabled=${config.u9Mirror.etlEnabled}`);
  });
}

bootstrap().catch((err) => {
  logSystem('server', 'error', `启动失败：${err instanceof Error ? `${err.message}
${err.stack ?? ''}` : String(err)}`);
  process.exit(1);
});
