# U9 业务领域

## 查询路径

- `createGateway.ts`：按 `U9_QUERY_SOURCE`（`mysql` | `sqlserver`）为员工/管理端注入网关；默认 `sqlserver` 便于对照与回滚。
- `mirrorGateway.ts`：只读 MySQL `u9_mirror_*`，实现同一 `U9Gateway` 契约（列表、详情、客户池、回款候选、预计算汇总）。
- `sqlServerGateway.ts`：直连 U9（对照/回滚，以及汇总过程预计算时调用）；ODBC 经 `sqlClient.ts`。

## 镜像抽取（ETL）

- `etl/u9RawQueries.ts`：**单表**参数化查询，禁止 SQL 表关联；`IN` 按 `U9_ETL_IN_CHUNK` 分批。
- `etl/assemble.ts`：按 ID 在应用层拼接，过滤口径与现网一致（出货业务员归属、未取消、DocStatus）。
- `etl/extractWindow.ts` / `writer.ts` / `syncJob.ts` / `scheduler.ts`：按业务日期窗口增量或夜间校对写入镜像；失败不前移水位；成功后失效进程缓存并触发镜像回款留单。
- `etl/summaryPrecompute.ts`：抽取窗口内按绑定业务员调用 U9 原汇总过程写入 `u9_mirror_summary_rows`，员工查询不再 `EXEC` 过程。

## 回款与缓存

- `receiptNotificationService.ts`：`U9_ETL_ENABLED=true` 时以镜像留单为主并拉长补漏间隔；未启用 ETL 时保持原直连轮询。
- `queryCache.ts`：进程短 TTL；同步成功 `invalidateU9QueryCache`。

## 其它

- `money.ts` / `pdf.ts`：金额精度与业务 PDF（样式对齐工资表）不变。
- 功能与页面冻结：仅允许不改变口径与接口行为的性能路径切换；配置见 `config.u9Mirror` 与 `.env.example`。
