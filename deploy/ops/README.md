# ops — 运维配置与手册

## 职责

面向 Windows 10 部署服务器的备份、日志轮转、调度任务与日常运维手册。脚本只读取 `server/.env` 或命令行参数，不在仓库或日志中保存数据库密码。

## 目录结构

- `backup/mysql-backup.ps1`：Windows 备份脚本（MySQL + `uploads/` + `.runtime/`）。
- `backup/mysql-backup.sh`：Linux / Git Bash 版本。
- `logs/rotate-logs.ps1`：Windows Nginx 日志轮转（复制归档、清空、`nginx -s reopen`）。
- `logs/logrotate-yunqi.conf`：Linux 应用日志轮转规则。
- `scheduler.ps1`：Windows 运维调度器，读取 `.env` 中的开关和周期，执行备份与日志轮转。
- `install-windows-tasks.ps1`：把调度器注册为开机启动的计划任务（需管理员）。

## 环境变量

在 `server/.env` 中配置，修改后调度器下一轮自动生效：

```ini
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=14
BACKUP_DIR=D:\yunqi-backups
MYSQLDUMP_BIN=C:\Program Files\MySQL\MySQL Server 9.7\bin\mysqldump.exe

LOG_ROTATE_ENABLED=true
LOG_ROTATE_INTERVAL_HOURS=24
NGINX_LOG_DIR=C:\nginx-1.30.6\logs
NGINX_EXE=C:\nginx-1.30.6\nginx.exe

LOG_ENABLED=true
LOG_DIR=logs
LOG_RETENTION_DAYS=30
LOG_TO_CONSOLE=true
```

- `BACKUP_ENABLED=false` 时调度器和备份脚本都直接跳过，不会产生备份文件。
- `BACKUP_INTERVAL_HOURS` 是两次备份的最小间隔；调度器每 60 秒检查一次。
- 备份脚本也支持手动运行，命令行参数优先于 `.env`。

## 备份

### 备份范围

| 内容 | 说明 |
|---|---|
| MySQL 数据库 | `mysqldump --single-transaction`，不锁表 |
| `server/uploads/` | 发票、附件、合同、拜访照片、工资条等文件 |
| `server/.runtime/` | AI 节点密钥的加密密钥文件；**丢失后已保存的 AI 凭据无法解密** |
| `server/.env` | 建议单独加密保管，不要和普通备份放在一起 |
| Nginx 配置、证书 | 由系统或证书工具管理，建议纳入服务器备份 |

`web/dist`、`server/dist` 可由代码重新构建，无需备份。

### Windows 10 运行方式

手动执行：

```powershell
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\ops\backup\mysql-backup.ps1
```

自动执行（推荐）：以管理员身份注册调度任务，之后按 `.env` 的周期自动备份：

```powershell
powershell -ExecutionPolicy Bypass -File C:/yunqi/deploy/ops/install-windows-tasks.ps1
Get-ScheduledTask -TaskName YunqiOpsScheduler | Get-ScheduledTaskInfo
```

安装后调度器会立即做一次到期检查：首次且 `BACKUP_ENABLED=true` 时会马上执行一次备份，之后按周期执行。

备份文件写入 `BACKUP_DIR`，日志写入 `server\logs\ops\backup\YYYY-MM-DD.log`。

### Linux 运行方式

```bash
APP_DIR=/srv/yunqi BACKUP_DIR=/var/backups/yunqi RETENTION_DAYS=14 \
  /srv/yunqi/deploy/ops/backup/mysql-backup.sh
```

cron 示例：

```cron
30 2 * * * APP_DIR=/srv/yunqi BACKUP_DIR=/var/backups/yunqi /srv/yunqi/deploy/ops/backup/mysql-backup.sh
```

### 恢复步骤

1. 停止服务：`Stop-Service YunqiServer`（Windows）或 `systemctl stop yunqi-office`（Linux）。
2. 恢复数据库（Windows 示例）：
   ```powershell
   & "C:\Program Files\MySQL\MySQL Server 9.7\bin\mysql.exe" -u root -p < D:\yunqi-backups\yunqi_20261117_023000.sql
   ```
   Linux 示例：`gunzip -c yunqi_20261117_023000.sql.gz | mysql -u root -p`。
3. 恢复文件：
   ```powershell
   Expand-Archive D:\yunqi-backups\yunqi_uploads_20261117_023000.zip -DestinationPath C:\yunqi\server -Force
   Expand-Archive D:\yunqi-backups\yunqi_runtime_20261117_023000.zip -DestinationPath C:\yunqi\server -Force
   ```
4. 启动服务并验证：`curl http://127.0.0.1:3100/health`，再登录后台抽查数据。
5. 每季度至少做一次恢复演练（在测试库/测试目录执行）。

> 备份包含员工、工资、合同等敏感数据：备份目录权限仅给运行账户，异地保存建议加密（age/GPG/BitLocker），不要把备份提交到 Git。

## 模块运行日志

服务端日志统一在 `server/logs/`，按端、模块、日期分文件；`LOG_ENABLED=false` 可关闭，`LOG_RETENTION_DAYS` 控制保留天数。

| 模块 | 目录 |
|---|---|
| 管理端接口 | `logs/admin/<module>/YYYY-MM-DD.log` |
| 小程序端接口、AI 节点 | `logs/miniprogram/<module>/YYYY-MM-DD.log` |
| 服务启动、数据库、U9 同步、健康检查 | `logs/system/<module>/YYYY-MM-DD.log` |
| 备份 | `logs/ops/backup/YYYY-MM-DD.log` |
| 调度器 | `logs/ops/scheduler/YYYY-MM-DD.log` |

模块示例：`admin/auth`、`admin/employees`、`admin/hr`、`admin/approvals`、`admin/models-formulas`、`admin/u9`；`miniprogram/approvals`、`miniprogram/attendance`、`miniprogram/invoices`、`miniprogram/workbench`；`system/server`、`system/db`、`system/u9`、`system/health`。

常用命令：

```powershell
Get-Content C:\yunqi\server\logs\admin\approvals\2026-11-17.log -Tail 100 -Wait
Get-Content C:\yunqi\server\logs\miniprogram\attendance\2026-11-17.log -Tail 100
Get-ChildItem C:\yunqi\server\logs -Recurse -Filter *.log | Sort-Object LastWriteTime -Descending | Select-Object -First 10
Get-Content C:\yunqi\server\logs\ops\scheduler\2026-11-17.log -Tail 50
```

其他日志：

| 来源 | 位置 |
|---|---|
| Nginx 访问/错误 | `NGINX_LOG_DIR\access.log`、`error.log` |
| MySQL 错误/慢查询 | MySQL 数据目录的 `hostname.err`，慢查询按 MySQL 配置 |
| 小程序客户端 | 微信公众平台「运维中心 → 实时日志/性能监控」；体验版 vConsole |

请求日志只记录路径，不记录查询参数和请求体；不会把签名地址、令牌、密码写入文件。

### 日志轮转

- 服务端日志按日期分文件，不需要按大小轮转；只按 `LOG_RETENTION_DAYS` 清理过期文件。
- Nginx 日志是连续写入，由 `scheduler.ps1` 按 `LOG_ROTATE_INTERVAL_HOURS` 调用 `rotate-logs.ps1`：复制为带时间戳的归档、清空原文件、执行 `nginx -s reopen`。
- Linux 使用 `logs/logrotate-yunqi.conf`（Nginx 包通常自带规则）。

## 日常检查

- `curl http://127.0.0.1:3100/health` 返回 `{"ok":true}`；后台 `http://服务器IP:8080` 可登录。
- 检查磁盘：`Get-PSDrive`，确认 `BACKUP_DIR` 和日志盘空间。
- 检查最近错误：`Get-Content logs\system\server\*.log -Tail 200 | Select-String "ERROR"`。
- 检查备份：`logs\ops\backup` 当天是否有成功记录、`BACKUP_DIR` 文件大小是否正常。
- 检查证书到期：`openssl x509 -enddate -noout -in fullchain.pem` 或 certbot 续期日志。

## 发布与回滚

1. 拉取代码 → `npm run install:all` → `npm run build:server` → `npm run build:web`。
2. 先执行一次备份。
3. 重启 `YunqiServer` 计划任务/服务，`nginx -s reload`。
4. 冒烟：健康检查、后台登录、小程序登录/打卡/审批。
5. 回滚：切回上一个 Git 版本重新构建；涉及数据变更时恢复对应备份。

## 安全约束

- `3100`、`3306`、后台 `8080` 不对公网开放；只暴露小程序 `443`。
- 备份和生产 `.env` 不进入 Git；`WORKFLOW_CREDENTIAL_KEY` / `.runtime` 与数据库同等重要。
- 日志和备份包含员工 ID、IP、工资等敏感信息，只给运维人员访问，对外提供前脱敏。
- 管理员账号、数据库账号使用强密码；服务端已内置登录失败限制。

## 相关文档

[部署说明](../README.md)、[Nginx 配置](../nginx/README.md)、[服务端日志说明](../../server/logs/README.md)、[项目架构约束](../../AGENTS.md)。
