# sql 目录说明

## 职责

数据库建表结构；增量迁移在 `src/shared/db/pool.ts`。工资发放补充字段、逐员工金额和已发放批次快照分别存储于独立表，不改写原工资批次明细；工资月份可有多个批次，通过月份锁表协调添加和复核；工资条 PDF 和已读版本保存在 `hr_payroll_payslips`，发放前的文件按管理员及版本暂存在 `hr_payroll_payslip_staging`。

职务目录在 `job_titles`，旧工资明细没有职务快照时，迁移前的显示值保存在 `hr_payroll_legacy_job_titles`。

`custom_approval_workflows` 按审批类型保存独立流程设计稿及版本，不参与现有审批流转；表由 `schema.sql` 的幂等建表语句创建。

## 主要内容

- 主要文件：`schema.sql`。

## 维护约束

数据库结构变更须同时检查 schema、增量迁移、初始化及两端兼容；保留事务边界。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
