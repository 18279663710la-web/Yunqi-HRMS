import fs from 'node:fs';

import { createApp } from './app';
import { config } from './config';
import { ensureDatabase, ensureSchema } from './shared/db/pool';
import { seedDatabase } from './shared/db/seed';
import { seedAttendanceIfEmpty } from './shared/db/attendanceSeed';
import { ensureDefaultAdmin } from './admin/admin-accounts/adminAuthService';
import { backfillEmployeeJobCategories } from './admin/employees/adminEmployeeService';
import { startExpenseAiWorker } from './domains/approvals/expenseAiService';
import { backfillJobTitles } from './domains/employees/jobTitleService';

async function bootstrap(): Promise<void> {
  fs.mkdirSync(config.uploadDir, { recursive: true });

  if (config.autoMigrate) {
    await ensureDatabase();
    await ensureSchema();
    const seeded = await seedDatabase(false);
    if (seeded) console.log('[db] 首次启动：已写入演示数据');
    const attendanceSeeded = await seedAttendanceIfEmpty();
    if (attendanceSeeded) console.log('[db] 已生成演示考勤记录');
    const adminSeeded = await ensureDefaultAdmin();
    if (adminSeeded) console.log('[admin] 已创建默认管理员');
    const backfilled = await backfillEmployeeJobCategories();
    if (backfilled) console.log(`[db] 已补齐 ${backfilled} 名员工的职位分类`);
    await backfillJobTitles();
  }

  const app = createApp();
  startExpenseAiWorker();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] http://127.0.0.1:${config.port}`);
    console.log(`[db] ${config.mysql.user}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
    console.log(`[ocr] driver=${config.ocrDriver}  [verify] driver=${config.verifyDriver}`);
  });
}

bootstrap().catch((err) => {
  console.error('[server] 启动失败：', err);
  process.exit(1);
});
