# U9 业务领域

## 查询路径

- `createGateway.ts`：按 `U9_QUERY_SOURCE`（`mysql` | `sqlserver`）为员工/管理端注入网关。本机对照通过后使用 `mysql`。
- `mirrorGateway.ts`：只读 MySQL `u9_mirror_*`，实现同一 `U9Gateway` 契约（列表、详情、客户池、回款候选、预计算汇总）。
- `sqlServerGateway.ts`：直连 U9（回滚对照，以及汇总过程预计算时调用）；ODBC 经 `sqlClient.ts`（默认 `Server=.`、Windows 身份、信任证书）。

## 镜像抽取（ETL）

- `etl/u9RawQueries.ts`：**单表**参数化查询，禁止 SQL 表关联；`IN` 按 `U9_ETL_IN_CHUNK` 分批；仅传入可安全 `CONVERT(bigint)` 的数字 ID。
- `etl/assemble.ts`：按 ID 在应用层拼接，过滤口径与现网一致（出货业务员归属、未取消、DocStatus）。
- `etl/extractWindow.ts` / `writer.ts` / `syncJob.ts` / `scheduler.ts`：
  - **部署全量 `bootstrap`**：自 U9 最早业务日（或 `U9_ETL_FULL_SINCE`）至今天，按月切片写入；启动时若无成功同步且 `U9_ETL_BOOTSTRAP_ON_START=true` 自动执行；并刷汇总矩阵。
  - **白天增量 `incremental`**：按水位回看 `U9_ETL_LOOKBACK_DAYS`；**不**刷新汇总。
  - **夜间全量校对 `nightly`**（默认 2 点）：单据全量重抽 + 汇总矩阵（每绑定业务员 × 每个 `from` × `to=当月` 调原汇总过程写入镜像）。
  - 失败不前移水位；成功后失效进程缓存并触发镜像回款留单。
- `etl/summaryPrecompute.ts`：仅 nightly / bootstrap 调用；`from` 从全量起点年份的 `YYYY-01` 起至当月；空月金额存空串；写完清理非当月 `to` 旧键。员工查询只读镜像，不再 `EXEC` 过程。
- 汇总 PDF：列宽保底、月数过多时加宽页面（`minWidth`），避免金额与表头被压窄折行。
- 业务维护窗：本地 `U9_BUSINESS_MAINTENANCE_START_HOUR`～`END_HOUR`（默认 0–2）内 `/api/business/*` 返回 503。
- 强制全量：`npx tsx scripts/u9-mirror-bootstrap.ts`

### 同步状态

- `u9_mirror_sync_state`：`watermark_date`、`last_success_at`、`last_mode`。
- `u9_mirror_sync_runs`：每次运行的成败、错误摘要、`stats_json`。
- 调度：`U9_ETL_ENABLED=true` 时启动；白天增量间隔 `U9_ETL_INCREMENTAL_MS`；夜间小时 `U9_ETL_NIGHTLY_HOUR`；`U9_ETL_SKIP_HOURS` 可跳过高峰。

## 回款与缓存

- `receiptNotificationService.ts`：ETL 启用时以镜像留单为主并拉长补漏间隔；未启用时直连轮询。
- `queryCache.ts`：进程短 TTL；同步成功 `invalidateU9QueryCache`。

## 切换与回滚

1. 部署：启用 ETL 后先全量（自动或 `u9-mirror-bootstrap.ts`），`U9_QUERY_SOURCE=mysql`。
2. `npx tsx scripts/u9-mirror-parity.ts <operatorId> <period>` 对照应收列表。
3. 回滚：`U9_QUERY_SOURCE=sqlserver` 重启。

本机说明：早期仅抽 2026 年窗口会导致 2024–2025 历史偏少；应使用部署全量覆盖 U9 最早业务日至今。

## 其它

- `money.ts` / `pdf.ts`：金额精度与业务 PDF（样式对齐工资表）不变。
- 功能与页面冻结：仅允许不改变口径与接口行为的性能路径切换。
- Phase 2 未做：Redis、Kafka、独立机、原报表导出、小程序展示同步时间。
