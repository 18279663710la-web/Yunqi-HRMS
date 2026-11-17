# logs — 服务端运行日志

## 职责

保存服务端运行日志，按端、业务模块和日期分文件，便于按模块排错。日志目录本身不纳入 Git，仅保留本说明。

## 目录结构

```text
logs/
├── admin/<module>/YYYY-MM-DD.log          # Web 管理后台接口
├── miniprogram/<module>/YYYY-MM-DD.log    # 小程序员工端接口与 AI 节点
├── system/<module>/YYYY-MM-DD.log         # 服务启动、数据库、U9 同步、健康检查
└── ops/
    ├── backup/YYYY-MM-DD.log              # 数据库/文件备份结果
    └── scheduler/YYYY-MM-DD.log           # 备份与日志轮转调度器
```

模块名由请求路径自动归类，例如：

- `admin/auth`、`admin/employees`、`admin/hr`、`admin/attendance`、`admin/approvals`、`admin/notices`、`admin/models-formulas`、`admin/u9`、`admin/audit`
- `miniprogram/auth`、`miniprogram/approvals`、`miniprogram/attendance`、`miniprogram/invoices`、`miniprogram/notices`、`miniprogram/workbench`、`miniprogram/business`、`miniprogram/onboarding`
- `system/server`、`system/db`、`system/u9`、`system/health`
- `miniprogram/approvals` 还记录 AI 审批节点的失败重试

每行格式：

```text
2026-11-17 15:01:04.025 [WARN] [admin/auth] GET /api/admin/auth/me 401 1ms ip=127.0.0.1
```

请求日志只记录路径，不记录查询参数和请求体，避免签名地址、令牌、密码等内容落盘。

## 配置

在 `server/.env` 中设置：

- `LOG_ENABLED`：总开关，默认 `true`
- `LOG_DIR`：日志根目录，默认 `logs`（相对 `server/`）
- `LOG_RETENTION_DAYS`：保留天数，默认 `30`，服务启动时及每 6 小时清理一次
- `LOG_TO_CONSOLE`：是否同时输出控制台，默认 `true`

## 维护约束

日志可能包含员工 ID、IP 等排错信息，属于运行时数据：不要提交到 Git，不要随对外交付包分发；需要提供给外部排错时先脱敏。服务端日志已按日期分文件，不需要再按大小轮转；Nginx 连续写入的日志由 `deploy/ops/logs` 中的脚本或系统 logrotate 处理。

## 相关文档

[服务端说明](../../README.md)、[部署与运维](../../deploy/README.md)。
