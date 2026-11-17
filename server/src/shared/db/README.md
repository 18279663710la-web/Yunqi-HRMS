# db 目录说明

## 职责

MySQL 连接池、事务、增量迁移、基础数据初始化、测试演示夹具和建库入口。

启动和 `db:setup` 只调用 `initializeBaseData`：写入五种固定审批类型、八类工作台快捷入口、`D00` 未分配组织、空公司配置和默认公司日历，再由 `ensureDefaultAdmin` 写入超级管理员；不写员工、员工账号、公告、考勤或审批单。`seedDemoData` 与 `attendanceSeed.ts` 仅为集成测试提供演示夹具，使用独立测试数据库。

初始化先补齐旧员工分类，再调用职务及平级组织迁移；迁移标记保证重复启动不覆盖管理员后续维护的职务和组织。审批测试及发布表由幂等建表创建，旧测试哈希缺失时自动使结果失效；旧发布数据若缺少表单快照则阻止迁移，避免猜测历史表单。`quickActionMigration.ts` 将旧工作台“公告通知”快捷入口替换为“拜访登记”，公告数据保留。

## 主要内容

- 主要文件：`attendanceSeed.ts`、`invoiceSamples.ts`、`pool.ts`、`quickActionMigration.ts`、`seed.ts`、`seedApprovalCleanup.ts`、`seedData.ts`、`setup.ts`。其中 `seed.ts` 的 `initializeBaseData` 用于生产初始化，`seedDemoData` 及 `attendanceSeed.ts`、`seedData.ts` 仅用于测试。

## 维护约束

数据库结构变更须同时检查 schema、增量迁移、初始化及两端兼容；保留事务边界。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
