/**
 * 可选真库口径对照：同一业务员+期间，比较 sqlServerU9 与 mirrorU9 的应收列表 docNo/行数。
 * 用法（先跑 ETL 写入镜像）：
 *   npx tsx scripts/u9-mirror-parity.ts <operatorId> <period>
 * 例：npx tsx scripts/u9-mirror-parity.ts 123456 2026-09
 */
import { sqlServerU9 } from '../src/domains/u9/sqlServerGateway';
import { mirrorU9 } from '../src/domains/u9/mirrorGateway';
import { closePool, ensureSchema } from '../src/shared/db/pool';

async function main(): Promise<void> {
  const operatorId = process.argv[2];
  const period = process.argv[3];
  if (!operatorId || !period) {
    console.error('用法: npx tsx scripts/u9-mirror-parity.ts <operatorId> <period>');
    process.exit(1);
  }
  await ensureSchema();
  const live = await sqlServerU9.listReceivableDocuments(operatorId, 1, { period });
  const mirror = await mirrorU9.listReceivableDocuments(operatorId, 1, { period });
  const liveKeys = live.map((d) => `${d.docNo}:${d.lines.length}`).sort();
  const mirrorKeys = mirror.map((d) => `${d.docNo}:${d.lines.length}`).sort();
  console.log('[live]', liveKeys);
  console.log('[mirror]', mirrorKeys);
  const same =
    liveKeys.length === mirrorKeys.length && liveKeys.every((k, i) => k === mirrorKeys[i]);
  if (!same) {
    console.error('口径不一致');
    process.exit(2);
  }
  console.log('OK: 应收列表 docNo/行数一致');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => closePool());
