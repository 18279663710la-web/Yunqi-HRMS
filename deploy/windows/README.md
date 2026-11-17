# windows — Windows 10 部署脚本

## 职责

Windows 10 服务器上的启动、停止与开机自启任务。应用仍由单个 Express 服务提供，脚本只负责进程和计划任务。

## 主要内容

- `start-server.ps1`：后台启动 `node dist/index.js`，PID 和启动日志写入 `server/logs/system/`。
- `stop-server.ps1`：按 PID 文件停止服务端。
- `install-tasks.ps1`：以 SYSTEM 注册开机任务 `YunqiServer`（服务端）、`YunqiNginx`（可选）和 `YunqiOpsScheduler`（备份/日志轮转）。

## 使用

```powershell
# 先构建
npm run build:server

# 手动启动/停止
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\start-server.ps1
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\stop-server.ps1

# 注册开机任务（需管理员）
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\install-tasks.ps1
```

Nginx 未安装在 `C:
ginx-1.30.6` 时，用 `-NginxExe` 指定实际路径，或加 `-SkipNginx` 只注册服务端和运维任务。

## 维护约束

- 服务端和 Nginx 都只监听本机/内网端口，公网只开放 443。
- 启动脚本不读取或打印 `.env` 内容；配置由服务端 dotenv 加载。
- 修改端口或路径时同步更新计划任务和 Nginx 配置。

## 相关文档

[部署说明](../README.md)、[运维手册](../ops/README.md)、[项目架构约束](../../AGENTS.md)。
