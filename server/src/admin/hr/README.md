# hr 目录说明

## 职责

人事管理接口及入职任务、员工档案、合同、薪资批次、离职和人事异动相关服务；合同文件已拆出服务和数据访问。

## 主要内容

- 主要文件：`contractFilesRepository.ts`、`contractFilesService.ts`、`hrContractFilesRoutes.ts`、`hrDepartureService.ts`、`hrLifecycleRoutes.ts`、`hrOnboardingService.ts`、`hrPolicy.ts`、`hrRoutes.ts`等。
- `hrLifecycleRoutes.ts` 提供出勤绩效规则的区间/单位配置接口及旧接口兼容。`hrTransitionService.ts` 处理调岗、晋升及撤销；`hrLifecycleRoutes.ts` 和 `hrRoutes.ts` 仍包含需要逐步拆分的业务与 SQL。

## 维护约束

沿用管理端鉴权、审计及现有事务和行锁；部分人事与入职表路由仍包含 SQL，继续分层时不得改变业务行为。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
