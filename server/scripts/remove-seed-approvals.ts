import { config } from '../src/config';
import { closePool, queryOne } from '../src/shared/db/pool';
import { findSeedApprovals, removeSeedApprovals } from '../src/shared/db/seedApprovalCleanup';

async function main(): Promise<void> {
  const ids = await findSeedApprovals();
  console.log(`数据库 ${config.mysql.database}：匹配到 ${ids.length} 条内置模拟审批`);
  if (ids.length) console.log(ids.join('\n'));
  if (process.argv.includes('--apply')) {
    console.log(`已删除 ${await removeSeedApprovals()} 条模拟审批及其关联记录`);
  } else {
    console.log('仅检查，未删除；加 --apply 执行清理。');
  }
  const remaining = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM approvals');
  console.log(`当前保留 ${Number(remaining?.total || 0)} 条审批`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => closePool());
