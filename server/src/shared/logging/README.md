# logging — 运行日志

## 职责

按端和业务模块写服务端运行日志文件，供排错和运维查看。请求日志只记录路径、状态、耗时、用户 ID 和 IP，不记录查询参数、请求体或请求头，避免签名地址和令牌落盘。

## 主要内容

- `logger.ts`：
  - `logModule(scope, module, level, message, meta)`：写管理端/小程序端/系统模块日志。
  - `logSystem(module, level, message, meta)`：服务启动、数据库、U9、健康检查等系统日志。
  - `logRequest` / `logRequestError`：请求完成后与未处理异常写入对应模块。
  - `cleanupOldLogs` / `startLogMaintenance`：按 `LOG_RETENTION_DAYS` 清理过期文件。
- 日志目录：`LOG_DIR`（默认相对 `server/` 的 `logs`），结构为 `<scope>/<module>/YYYY-MM-DD.log`，scope 为 `admin`、`miniprogram`、`system`；运维脚本另写 `ops/`。

## 配置

`LOG_ENABLED`、`LOG_DIR`、`LOG_RETENTION_DAYS`、`LOG_TO_CONSOLE`，见 `server/.env.example` 与 [logs/README.md](../../../logs/README.md)。

## 维护约束

新增运行时错误或后台任务日志时优先复用 `logModule` / `logSystem`，不要在业务代码里直接 `console` 写入敏感信息；新增路由前缀时同步补充 `moduleForPath` 的模块映射。日志文件属于运行时数据，不提交到 Git。

## 相关文档

[服务端日志目录](../../../logs/README.md)、[部署与运维](../../../../deploy/ops/README.md)、[项目架构约束](../../../AGENTS.md)。
