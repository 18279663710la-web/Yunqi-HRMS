# deploy — 部署配置

## 职责

面向 **Windows 10** 服务器的交付部署配置：Nginx 反向代理、服务端启动/停止、备份、日志轮转、运维调度和上线检查清单。不包含任何凭据、构建产物或运行时数据。

## 目录结构

- `nginx/conf.d/admin.conf`：管理后台入口（`http://服务器IP:8080`），静态托管 `web/dist` 并反代 `/api`、`/health`。
- `nginx/conf.d/miniprogram.conf.template`：小程序公网入口（`https://api.example.com`），需域名、备案、证书后启用。
- `ops/`：备份脚本、日志轮转、运维调度器、任务安装脚本和运维手册。
- `windows/`：Windows 服务端启动/停止和开机任务安装脚本。
- `systemd/yunqi-office.service`：Linux 部署的 systemd 示例（Windows 10 不使用）。

## 部署假设

```text
C:/yunqi/
├── server/                  # 服务端代码、dist/、uploads/、.runtime/、.env、logs/
└── web/dist/                # 管理后台构建产物
C:/nginx-1.30.6/             # Nginx（需自行安装）
```

Express 监听 `127.0.0.1:3100`；Nginx 对外提供 `8080`（后台）和 `443`（小程序）。

## 上线步骤

### 1. 构建

```powershell
npm run install:all
npm run build:server
npm run build:web
```

### 2. 服务端环境变量

按 `server/.env.example` 创建 `server/.env`，至少包含：

- `NODE_ENV=production`、`PORT=3100`
- `JWT_SECRET`：强随机；生产环境使用开发默认值会拒绝启动
- `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`
- `UPLOAD_DIR`、`CORS_ORIGIN`
- `WECHAT_APPID`、`WECHAT_APP_SECRET`
- `TENCENT_MAP_KEY`、`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`TENCENTCLOUD_REGION`、`VERIFY_DRIVER=tencent`
- `WORKFLOW_CREDENTIAL_KEY` 或 `WORKFLOW_CREDENTIAL_KEY_FILE`：AI 节点密钥加密用，**必须与数据库一起备份**
- `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_NAME`
- 日志：`LOG_ENABLED`、`LOG_DIR`、`LOG_RETENTION_DAYS`、`LOG_TO_CONSOLE`
- 备份：`BACKUP_ENABLED`、`BACKUP_INTERVAL_HOURS`、`BACKUP_RETENTION_DAYS`、`BACKUP_DIR`、`MYSQLDUMP_BIN`
- 日志轮转：`LOG_ROTATE_ENABLED`、`LOG_ROTATE_INTERVAL_HOURS`、`NGINX_LOG_DIR`、`NGINX_EXE`

不要提交 `.env`、`.env.local` 或任何密钥；备份数据库时同时备份 `server/.runtime/` 和上传目录。

### 3. 数据库

```powershell
npm run db:setup
```

不要在生产环境执行 `db:reset`。初始化后按需清理演示数据、导入真实员工与账号。

### 4. Nginx（Windows）

1. 把 `deploy/nginx/conf.d/admin.conf` 复制到 `<nginx>/conf/conf.d/admin.conf`。
2. 在 `<nginx>/conf/nginx.conf` 的 `http { ... }` 中加入：

   ```nginx
   include conf.d/*.conf;
   ```

3. 按实际路径修改 `admin.conf` 的 `root`（默认 `C:/yunqi/web/dist`）。
4. 在 Nginx 目录执行：

   ```bat
   nginx -t
   start nginx
   nginx -s reload
   ```

5. 域名、备案、证书就绪后，把 `miniprogram.conf.template` 改名为 `miniprogram.conf`，修改 `server_name` 和证书路径，再执行 `nginx -t` 与 reload。

要点：

- 后台只监听 `8080`，建议仅内网/VPN 访问；不要对公网开放明文后台。
- 小程序必须 `443` + 受信任证书 + 已备案域名；微信服务器域名不支持自定义端口。
- `/api` 与 `/health` 都要反代；只代理 `/api` 会导致小程序真机启动探测失败。
- 不要静态直出 `/uploads`（合同、模板等需要鉴权，报销原图使用签名地址）。
- 上传上限 10MB，Nginx 用 32m；PDF/AI 接口慢，`proxy_read_timeout` 用 120s。

### 5. 启动服务端（Windows 10）

```powershell
# 手动
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\start-server.ps1
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\stop-server.ps1

# 注册开机任务（需管理员）：YunqiServer、YunqiNginx、YunqiOpsScheduler
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\install-tasks.ps1
```

服务端控制台输出写入 `server/logs/system/console-YYYY-MM-DD.out.log` 和 `.err.log`；按模块的运行日志写入 `server/logs/admin|miniprogram|system`。

### 6. 备份与日志轮转

以管理员身份安装运维调度任务：

```powershell
powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\ops\install-windows-tasks.ps1
```

调度器每 60 秒读取一次 `server/.env`：

- `BACKUP_ENABLED=false` 时跳过备份；否则按 `BACKUP_INTERVAL_HOURS` 执行 `deploy/ops/backup/mysql-backup.ps1`。
- `LOG_ROTATE_ENABLED=false` 时跳过日志轮转；否则按 `LOG_ROTATE_INTERVAL_HOURS` 轮转 `NGINX_LOG_DIR` 下的 Nginx 日志。
- 备份日志：`server/logs/ops/backup/YYYY-MM-DD.log`；调度日志：`server/logs/ops/scheduler/YYYY-MM-DD.log`。

### 7. 小程序与微信后台

- `project.config.json` 的 `appid` 换成正式 AppID。
- `miniprogram/utils/apiOrigin.ts` 增加生产固定域名（真机不再探测局域网 IP）。
- 微信后台「服务器域名」配置 request / uploadFile / downloadFile 为 `https://api.example.com`。
- 「接口设置」申请地理位置接口（`getLocation`），场景为考勤打卡、拜访签到。
- 「用户隐私保护指引」声明位置、相册/摄像头、选中的文件。
- 提交审核时提供专用测试员工账号和审核备注，确保审核员可登录。

### 8. 上线检查

```powershell
curl.exe http://127.0.0.1:3100/health
curl.exe http://127.0.0.1:8080/health
curl.exe -I https://api.example.com/health
Get-ChildItem C:\yunqi\server\logs -Recurse -Filter *.log | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

浏览器打开 `http://服务器IP:8080` 能登录、能加载数据；小程序体验版真机验证登录、打卡定位、拜访登记、审批、公告、工资条和附件下载。

### Linux 部署

仓库同时保留 `deploy/ops/backup/mysql-backup.sh`、`deploy/ops/logs/logrotate-yunqi.conf` 和 `deploy/systemd/yunqi-office.service`；把 Nginx `admin.conf` 的 `root` 改为 `/srv/yunqi/web/dist`，证书路径改为 `/etc/nginx/ssl/...`。

## 维护约束

`deploy/` 只放部署配置与说明；不写凭据、不提交构建产物和运行日志。修改路径、端口、域名时同步更新 `nginx/README.md`、`ops/README.md` 与本文。

## 相关文档

[项目架构约束](../AGENTS.md)、[运维手册](ops/README.md)、[Nginx 配置](nginx/README.md)、[项目目录职责总览](../docs/项目目录职责说明.md)。
