# hr 目录说明

## 职责

人事管理接口及入职任务、员工档案、合同、薪资批次、离职和人事异动相关服务；合同文件已拆出服务和数据访问。

## 主要内容

- 主要文件：`contractFilesRepository.ts`、`contractFilesService.ts`、`hrContractFilesRoutes.ts`、`hrDisbursementRoutes.ts`、`hrDisbursementService.ts`、`hrDepartureService.ts`、`hrLifecycleRoutes.ts`、`hrOnboardingService.ts`、`hrPolicy.ts`、`hrRoutes.ts`等。
- `hrLifecycleRoutes.ts` 提供出勤与加班绩效规则的区间/单位配置接口及旧接口兼容。`hrTransitionService.ts` 处理调岗、晋升及撤销；`hrLifecycleRoutes.ts` 和 `hrRoutes.ts` 仍包含需要逐步拆分的业务与 SQL。
- 工资批次列表支持按月份查询；`hrDisbursementRoutes.ts` 校验请求，`hrDisbursementService.ts` 管理补充项及金额的事务、版本和只读计算。历史工资发放记录保留只读查询，发放登记接口已移除。工资固定字段、扩展字段与手工扣除按快照校验和重算，成功返回新版本快照及工资合计；固定字段覆盖保留原值，保留事务、行锁与审计。

## 维护约束

沿用管理端鉴权、审计及现有事务和行锁；部分人事与入职表路由仍包含 SQL，继续分层时不得改变业务行为。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
