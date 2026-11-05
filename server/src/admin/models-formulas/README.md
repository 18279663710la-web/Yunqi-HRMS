# models-formulas 目录说明

## 职责

入职表模板、薪资构成模型与薪资流程的管理接口；部分绩效规则接口仍位于 `admin/hr/`。

## 主要内容

- 主要文件：`onboardingFormRoutes.ts`、`payrollWorkflowRoutes.ts`、`salaryModelsRoutes.ts`。

## 维护约束

沿用管理端鉴权、审计及现有事务和行锁；部分人事与入职表路由仍包含 SQL，继续分层时不得改变业务行为。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
