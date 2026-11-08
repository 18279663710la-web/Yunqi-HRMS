# 隔离性能压测工具

本目录复用项目的真实服务代码，在临时 Docker 内部网络和空 MySQL 中生成虚构数据并发起请求。测试记录见根目录 `性能压力测试记录.md`。本机 Docker 容器共享宿主机资源；结果不能代表生产配置或真机体验。

`2026-11-08-首轮结果.json` 保存本轮压测脚本输出，字段耗时单位为毫秒；测试范围和限制以根目录记录为准。
`2026-11-08-持续资源采样.csv` 保存 50、100 人持续场景的分钟级容器 CPU 和内存采样。
`2026-11-08-登录事件循环.jsonl` 保存带观测器复测集中登录时的事件循环采样，时间为 UTC。
`2026-11-08-工作台员工查询观测.json` 保存单次模拟工作台请求前后的数据库语句摘要计数。
`2026-11-08-并发错误观测.json` 保存隔离库中冲突键及死锁的脱敏人工摘录。

## 隔离要求

- 只对新建的、没有宿主机端口映射的内部网络执行，应用和数据库不能连接用户现有服务或真实外部依赖；不要传入实际 `.env`、真实数据库凭据或用户文件。
- 脚本固定访问内部网络别名 `app` 和 `db`、测试库 `yunqi_perf`，并要求显式设置 `PERF_ISOLATED=yes` 与临时测试凭据。这些检查只是防误用辅助，不能替代确认容器、网络、数据卷和环境变量。
- 测试创建虚构员工、审批及工资条，并修改隔离数据库内的打卡设置和已读状态；不可对共享库使用。
- U9 原生驱动未安装，AI 和发票查验不得接入真实服务。示例中的非腾讯发票查验配置会返回通道未配置，不模拟查验成功。图片上传使用合成字节，仅测上传，不验证图像可解码或查验结果。

## 环境准备

在 PowerShell 中从项目根目录执行；以下构建只取当前 **Git HEAD** 的 `server/`，不会复制未提交更改、环境文件或上传文件。执行前用 `git status --short` 确认待测版本；如需测试未提交源码，先明确构建来源且排除敏感文件。

```powershell
$perfId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$perfNetwork = "yunqi-perf-$perfId"
$perfDb = "yunqi-perf-db-$perfId"
$perfApp = "yunqi-perf-app-$perfId"
$perfLoad = "yunqi-perf-load-$perfId"
$perfImage = "yunqi-perf-server:$perfId"
$perfDbPassword = [guid]::NewGuid().ToString('N')
$perfJwtSecret = [guid]::NewGuid().ToString('N')
$perfBuild = Join-Path $env:TEMP $perfNetwork
New-Item -ItemType Directory -Path $perfBuild | Out-Null
git archive --format=tar HEAD server | tar -xf - -C $perfBuild
Copy-Item '性能压测/Dockerfile' (Join-Path $perfBuild 'Dockerfile')
docker build -t $perfImage $perfBuild
docker network create --internal $perfNetwork
docker run -d --name $perfDb --network $perfNetwork --network-alias db --cpus 2 --memory 1g -e "MYSQL_ROOT_PASSWORD=$perfDbPassword" -e MYSQL_DATABASE=yunqi_perf mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

等待 MySQL 初始化完成，通过容器日志确认数据库已准备好，再启动应用和负载进程：

```powershell
docker logs --tail 20 $perfDb
docker run -d --name $perfApp --network $perfNetwork --network-alias app --cpus 2 --memory 768m -e MYSQL_HOST=db -e MYSQL_USER=root -e "MYSQL_PASSWORD=$perfDbPassword" -e MYSQL_DATABASE=yunqi_perf -e MYSQL_POOL_SIZE=10 -e AUTO_MIGRATE=true -e TZ=Asia/Shanghai -e VERIFY_DRIVER=mock -e EXPENSE_AI_DRIVER=deepseek -e "JWT_SECRET=$perfJwtSecret" $perfImage
docker logs --tail 20 $perfApp
docker run -d --name $perfLoad --network $perfNetwork --cpus 1 --memory 512m --entrypoint sleep $perfImage infinity
docker exec $perfApp mkdir -p /perf
docker exec $perfLoad mkdir -p /perf
docker cp '性能压测/.' "${perfApp}:/perf"
docker cp '性能压测/.' "${perfLoad}:/perf"
docker exec -e PERF_ISOLATED=yes -e "PERF_MYSQL_PASSWORD=$perfDbPassword" $perfApp node /perf/fixture.cjs
docker exec -e PERF_ISOLATED=yes -e "PERF_JWT_SECRET=$perfJwtSecret" $perfLoad node /perf/load.cjs --selftest
```

等待服务日志中的监听信息后才运行数据准备。`fixture.cjs` 只适用于全新的隔离库；不要对已有业务数据或重复执行。应用镜像构建时忽略依赖安装脚本，适合本轮未调用 U9 的场景，不等同于生产镜像。

## 运行和记录

负载脚本参数为场景、人数、启动分散时间（毫秒）；`sustain` 的第四个参数为每人的检查轮数。起始时段设置由 `fixture.cjs` 写入，仅适合当天 00:00–23:58 的上班打卡测试；下班场景需要在隔离库单独调整有效时间段。每轮写入场景应先重建测试库或明确记录测试状态，不能把“已经打卡”当成成功。

```powershell
docker exec -e PERF_ISOLATED=yes -e "PERF_JWT_SECRET=$perfJwtSecret" $perfLoad node /perf/load.cjs punch-in 100 30000
docker exec -e PERF_ISOLATED=yes -e "PERF_JWT_SECRET=$perfJwtSecret" $perfLoad node /perf/load.cjs login-workbench 100 0
docker exec -e PERF_ISOLATED=yes -e "PERF_JWT_SECRET=$perfJwtSecret" $perfLoad node /perf/load.cjs sustain 100 15000 121
```

场景名包括 `punch-in`、`punch-out`、`login`、`login-workbench`、`workbench`、`payslip`、`sustain`、`approval-read`、`approval-submit`、`contacts`、`notice`、`records`、`mixed` 和 `mixed-extended`。审批场景先对空测试库运行 `approval-fixture.cjs`；混合场景固定 100 人及脚本中的配比，扩展混合场景须先准备 U9 网关替身和对应测试账号。上传单测使用 `upload.cjs`；重复打卡、重复审批和工资条身份抽查脚本需按名称准备对应状态。

`overtime.cjs` 与 `onboarding.cjs` 需要同时提供测试库凭据和测试签名密钥，并在全新测试数据上运行；前者会在测试库回拨加班上班时间以模拟跨日。`large-pdf.cjs` 会替换测试员工的工资条并清除其已读状态，仅用于空隔离库中已有的 100 名测试员工。`observe.cjs` 是可选的 Node 预加载观测器，启用后会影响测量开销；只能在隔离服务进程中使用。

`ai-mock.cjs`、`expense.cjs` 和 `u9-mock.cjs`、`u9.cjs` 已在隔离环境执行：前者使用明确标识的合成查验缓存和本地模拟 AI，后者仅模拟 U9 网关；不能据此推断真实查验或 U9 的吞吐和隔离能力。不得在含真实数据的库中写入模拟查验记录。扩展场景在应用容器内运行负载脚本，与应用共享资源，与独立负载容器的基线不能直接等价比较。

扩展测试需另启无端口映射的应用容器，复用专用内部网络和测试库：关闭自动迁移，设置 `PERF_ISOLATED=yes`、`PERF_U9_MOCK=yes`，启动 Node 时使用 `--require /perf/observe.cjs --require /perf/u9-mock.cjs`；U9 PDF 须在容器内临时提供中文字体并通过 `U9_PDF_FONT` 指定。将 `ai-mock.cjs` 以单独进程启动在相同容器的回环地址，设置 `EXPENSE_AI_DRIVER=local` 和 `EXPENSE_AI_BASE_URL=http://127.0.0.1:9811/v1`。合成查验缓存命中测试需要 `VERIFY_DRIVER=tencent` 和非空的**虚构**腾讯配置值；只有确认 Docker 网络为 internal、无法访问真实外部服务后才能使用该设置。执行 `expense.cjs` 还须传入 `PERF_SYNTHETIC_VERIFY=yes`。测试记录中的网关响应、查验缓存和中文字体均为测试材料，不是生产配置。

记录启动分布、请求及业务失败、P50/P95/P99、每个场景的真实数据量，并在测试库核对写入；同时监测资源。`sustain` 为周期检查的近似模型，不包含真实小程序及页面渲染。外部服务、大文件、账号状态变化等未覆盖项目须单独说明。

测试结束后，仅移除本次 `$perfId` 创建的容器、内部网络、临时构建目录和专用匿名卷；清理前核对资源名称与绝对路径。不要清理其他 Docker 资源。若需复现，重新创建空环境，不重用测试数据。

## 上班场景混合测试

2026-11-09 的持续混合驱动为 `morning-load.cjs`：分别支持 50、100 名模拟用户，通过参数指定运行毫秒数和进入窗口毫秒数；分配普通打卡、工作台、审批、查阅和管理端角色。每个员工以约 15 秒闭环周期检查入职和工资条，并约每 60 秒进行对应角色操作；与实际固定定时器可能重叠的行为不同。部分员工使用测试账号密码登录，其他员工使用隔离环境签发的员工令牌。`morning-plan.test.cjs` 检查角色分配、失败判定和指标统计。

在已按本目录说明创建且核对过的空隔离环境中，先运行 `fixture.cjs`、`approval-fixture.cjs`，并使用 `morning-fixture.cjs prepare` 准备虚构加班单、5 名虚构管理员及业务员绑定；使用带 `morning-u9-mock.cjs` 的测试服务模拟 500 ms 网关延迟。`morning-fixture.cjs reset` 只允许在这一隔离测试库中清理本测试虚构账号的当日打卡和 `MOT` 前缀加班卡；`audit` 用于核对数量。压测进程需要隔离标记和临时测试签名密钥，数据库采样 `morning-monitor.cjs` 另需隔离库凭据。禁止在任何真实或共享数据库上运行。

混合结果 `2026-11-09-*.json` 包含请求量、真实在途并发、按分钟及按接口的 P50/P95/P99、失败原因和流程统计；同日期 JSONL/CSV 保存隔离 MySQL、事件循环及容器资源采样。请求结果保存为接口和分钟级聚合，不包含逐条请求延迟；所有时间、数据量、测试限制、清理情况和复测注意事项以根目录压力测试记录为准。
