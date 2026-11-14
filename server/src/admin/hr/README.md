# hr 目录说明

## 职责

人事管理接口及入职任务、员工档案、合同、薪资批次、离职和人事异动相关服务；合同文件已拆出服务和数据访问。确认离职前检查已发布流程审批人和待处理单据，并与发布共用员工行锁。已申请可撤销并恢复账号；已离职按复职日期恢复，未到期保持锁定。

## 主要内容

- 主要文件：`contractFilesRepository.ts`、`contractFilesService.ts`、`hrContractFilesRoutes.ts`、`hrDisbursementRoutes.ts`、`hrDisbursementService.ts`、`hrDepartureService.ts`、`hrLifecycleRoutes.ts`、`hrOnboardingService.ts`、`hrPolicy.ts`、`hrRoutes.ts`等。
- `hrLifecycleRoutes.ts` 提供出勤与加班绩效规则的区间/单位配置接口及旧接口兼容。`hrTransitionService.ts` 处理调岗、晋升及撤销；`hrLifecycleRoutes.ts` 和 `hrRoutes.ts` 仍包含需要逐步拆分的业务与 SQL。
- 工资批次列表支持按月份查询；`hrDisbursementRoutes.ts` 校验请求，`hrDisbursementService.ts` 管理补充项、金额、版本及发放快照。发放事务锁定批次并验证版本，写入按批次汇总的不可变记录，禁止重复发放及后续补充项修改；不执行付款。发放前按管理员及版本暂存工资条，发放时事务内验证文件齐全并同时发送；重发替换 PDF 并更新未读版本。工资固定字段、扩展字段与手工扣除按快照校验和重算，固定字段覆盖保留原值，保留事务、行锁与审计。

## 维护约束

薪资构成模型、工资批次、工资发放、工资发放记录目前暂时收尾；优化其他模块不得改变这四个模块的现有业务逻辑，除非用户提出硬性且明确的修改要求。涉及共享代码、数据或接口时保持行为兼容并验证受影响链路；详见项目根目录 `AGENTS.md` 和薪资发放开发说明。

沿用管理端鉴权、审计及现有事务和行锁；部分人事与入职表路由仍包含 SQL，继续分层时不得改变业务行为。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
