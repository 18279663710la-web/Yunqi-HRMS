/**
 * 强制执行一次部署全量同步（按月切片，起点自动取 U9 最早业务日或 U9_ETL_FULL_SINCE）。
 * 用法：npx tsx scripts/u9-mirror-bootstrap.ts
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  const { ensureDatabase, ensureSchema, closePool } = await import('../src/shared/db/pool');
  await ensureDatabase();
  await ensureSchema();
  const { runMirrorSync } = await import('../src/domains/u9/etl/syncJob');
  await runMirrorSync('bootstrap');
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { closePool } = await import('../src/shared/db/pool');
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
