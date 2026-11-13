# U9 业务领域

## 查询路径

- `createGateway.ts`：按 `U9_QUERY_SOURCE`（`mysql` | `sqlserver`）为员工/管理端注入网关。本机对照通过后使用 `mysql`。
- `mirrorGateway.ts`：只读 MySQL `u9_mirror_*`，实现同一 `U9Gateway` 契约（列表、详情、客户池、回款候选、预计算汇总）。
- `sqlServerGateway.ts`：直连 U9（回滚对照，以及汇总过程预计算时调用）；ODBC 经 `sqlClient.ts`（默认 `Server=.`、Windows 身份、信任证书）。

## 镜像抽取（ETL）

- `etl/u9RawQueries.ts`：**单表**参数化查询，禁止 SQL 表关联；`IN` 按 `U9_ETL_IN_CHUNK` 分批；仅传入可安全 `CONVERT(bigint)` 的数字 ID。
- `etl/assemble.ts`：按 ID 在应用层拼接，过滤口径与现网一致（出货业务员归属、未取消、DocStatus）。
- `etl/extractWindow.ts` / `writer.ts` / `syncJob.ts` / `scheduler.ts`：按业务日期窗口增量或夜间校对写入镜像；失败不前移水位；成功后失效进程缓存并触发镜像回款留单。
- `etl/summaryPrecompute.ts`：抽取窗口内按绑定业务员调用 U9 原汇总过程写入 `u9_mirror_summary_rows`，员工查询不再 `EXEC` 过程。

### 同步状态

- `u9_mirror_sync_state`：`watermark_date`、`last_success_at`、`last_mode`。
- `u9_mirror_sync_runs`：每次运行的成败、错误摘要、`stats_json`。
- 调度：`U9_ETL_ENABLED=true` 时启动；白天增量间隔 `U9_ETL_INCREMENTAL_MS`；夜间小时 `U9_ETL_NIGHTLY_HOUR`；`U9_ETL_SKIP_HOURS` 可跳过高峰。

## 回款与缓存

- `receiptNotificationService.ts`：ETL 启用时以镜像留单为主并拉长补漏间隔；未启用时直连轮询。
- `queryCache.ts`：进程短 TTL；同步成功 `invalidateU9QueryCache`。

## 切换与回滚

1. `U9_ETL_ENABLED=true`，必要时先 `U9_QUERY_SOURCE=sqlserver` 双跑。
2. `npx tsx scripts/u9-mirror-parity.ts <operatorId> <period>` 对照应收列表。
3. 对照通过后 `U9_QUERY_SOURCE=mysql` 并重启；启动日志应出现 `querySource=mysql`。
4. 回滚：`U9_QUERY_SOURCE=sqlserver` 重启。

本机验收（2026-11-13）：宽窗口抽取后，业务员 `1002501150010071` 在 2026-08/09 应收 `docNo`/行数与详情金额与直连一致，已切 mysql。

## 其它

- `money.ts` / `pdf.ts`：金额精度与业务 PDF（样式对齐工资表）不变。
- 功能与页面冻结：仅允许不改变口径与接口行为的性能路径切换。
- Phase 2 未做：Redis、Kafka、独立机、原报表导出、小程序展示同步时间。
