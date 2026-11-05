import { config } from '../../config';
import { closePool, ensureDatabase, ensureSchema } from './pool';
import { seedDatabase } from './seed';
import { seedAttendanceIfEmpty } from './attendanceSeed';
import { ensureDefaultAdmin } from '../../admin/admin-accounts/adminAuthService';
import { backfillEmployeeJobCategories } from '../../admin/employees/adminEmployeeService';

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  console.log(`[db] 准备数据库 ${config.mysql.user}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
  await ensureDatabase();
  await ensureSchema();
  const seeded = await seedDatabase(reset);
  console.log(seeded ? '[db] 演示数据已写入' : '[db] 数据库已有数据，跳过播种（如需重置请用 npm run db:reset）');
  const attendanceSeeded = await seedAttendanceIfEmpty();
  if (attendanceSeeded) console.log('[db] 演示考勤已生成');
  const adminSeeded = await ensureDefaultAdmin();
  if (adminSeeded) console.log('[admin] 已创建默认管理员');
  const backfilled = await backfillEmployeeJobCategories();
  if (backfilled) console.log(`[db] 已补齐 ${backfilled} 名员工的职位分类`);
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
