# nginx 配置目录说明

## 职责

面向 Windows 10 部署的 Nginx 反向代理配置：管理后台按 IP + 端口访问，小程序 API 按公网 HTTPS 域名访问；两者都转发到同一个 Express 服务（`127.0.0.1:3100`）。

## 主要内容

- `conf.d/admin.conf`：管理后台入口，监听 `8080`，托管 `C:/yunqi/web/dist` 并把 `/api/`、`/health` 转发到 Express。
- `conf.d/miniprogram.conf.template`：小程序公网入口模板，监听 `443`，需要域名、证书、备案后才能启用；未改名时不会被加载。

## Windows 10 启用方式

1. 把 `admin.conf` 复制到 `<nginx>/conf/conf.d/admin.conf`（目录不存在时新建）。
2. 在 `<nginx>/conf/nginx.conf` 的 `http { ... }` 中加入 `include conf.d/*.conf;`。
3. 按实际路径修改 `admin.conf` 的 `root`；默认是 `C:/yunqi/web/dist`。
4. 在 Nginx 目录执行：

   ```bat
   nginx -t
   start nginx
   nginx -s reload
   nginx -s stop
   ```

5. 域名、备案、证书就绪后，把 `miniprogram.conf.template` 改名为 `miniprogram.conf`，修改 `server_name`（默认 `api.example.com`）和证书路径（默认 `C:/yunqi/nginx/ssl/api.example.com/`），再执行 `nginx -t` 与 reload。

## 要点

- 后台只监听 `8080`，建议仅内网/VPN 访问；不要对公网开放明文后台。
- 小程序必须 `443` + 受信任证书 + 已备案域名；微信服务器域名不支持自定义端口。
- `/api` 与 `/health` 都要反代；只代理 `/api` 会导致小程序真机启动探测失败。
- 不要静态直出 `/uploads`（合同、模板等需要鉴权，报销原图使用签名地址）。
- 上传上限 10MB，Nginx 用 32m；PDF/AI 接口慢，`proxy_read_timeout` 用 120s。
- Linux 部署时把 `root` 改为 `/srv/yunqi/web/dist`，证书路径改为 `/etc/nginx/ssl/...`，其余规则相同。

## 维护约束

两个入口都只反代 `/api` 与 `/health`；`/uploads` 不静态直出，文件下载由 Express 鉴权或签名控制。修改域名、证书路径、站点根目录后，用 `nginx -t` 校验再 reload。

## 相关文档

[部署说明](../README.md)、[运维手册](../ops/README.md)、[项目架构约束](../../AGENTS.md)。
