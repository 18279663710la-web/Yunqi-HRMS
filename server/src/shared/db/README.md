# db 目录说明

## 职责

MySQL 连接池、事务、增量迁移、种子、演示数据和建库入口。

## 主要内容

- 主要文件：`attendanceSeed.ts`、`invoiceSamples.ts`、`pool.ts`、`seed.ts`、`seedApprovalCleanup.ts`、`seedData.ts`、`setup.ts`。

## 维护约束

数据库结构变更须同时检查 schema、增量迁移、初始化及两端兼容；保留事务边界。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
