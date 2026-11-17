import { config } from '../../config';
import { closePool, ensureDatabase, ensureSchema } from './pool';
import { initializeBaseData } from './seed';
import { ensureDefaultAdmin } from '../../admin/admin-accounts/adminAuthService';
import { backfillEmployeeJobCategories } from '../../admin/employees/adminEmployeeService';
import { backfillJobTitles } from '../../domains/employees/jobTitleService';
import { migrateOrganizations } from '../../domains/employees/organizationService';

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  console.log(`[db] 准备数据库 ${config.mysql.user}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
  await ensureDatabase();
  await ensureSchema();
  await initializeBaseData(reset);
  console.log('[db] 基础数据已初始化（五种固定审批类型、未分配组织、默认公司日历）');
  const adminSeeded = await ensureDefaultAdmin();
  if (adminSeeded) console.log('[admin] 已创建默认管理员');
  const backfilled = await backfillEmployeeJobCategories();
  if (backfilled) console.log(`[db] 已补齐 ${backfilled} 名员工的职位分类`);
  await backfillJobTitles();
  await migrateOrganizations();
  await closePool();
}

main().catch(async (err) => {
  console.error('[db] 初始化失败：', err);
  try {
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
