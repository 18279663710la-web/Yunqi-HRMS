# payroll 目录说明

## 职责

薪资模型、工资计算、一键添加、考勤数据绑定、考勤与加班规则、薪资流程及相关数据访问；添加和复核通过月份锁防止员工重复进入当月已复核批次。

## 主要内容

- 主要文件：`overtimePayrollService.ts`、`payrollAttendanceService.ts`、`payrollAutoService.ts`、`payrollModelCalculation.ts`、`payrollWorkflowRepository.ts`、`payrollWorkflowService.ts`、`salaryModelRepository.ts`、`salaryModelSchema.ts`等。
- `attendanceRuleConfig.ts` 与 `attendanceRuleConfigRepository.ts` 管理出勤绩效规则的区间/单位模式校验和存储。
- `overtimePayrollService.ts` 与 `overtimeRuleConfigRepository.ts` 负责加班绩效规则校验、计算、兼容与存储；工资明细绑定加班费时保留规则与时长快照。
- `attendanceRuleCalculation.ts` 按出勤或缺勤的比例、天数及区间或单位规则计算有符号绩效调整，保存工资明细时保留计算依据。
- `salaryModelService.ts` 管理薪资模型读取和字段规则；`salaryModelUpdateService.ts` 处理模型变更和员工定薪同步。`payrollWorkflowService.ts` 与 `payrollWorkflowRepository.ts` 分别负责流程业务和存储。
- `payrollDraftSync.ts` 在模型保存及草稿访问时同步同名字段用途、重算金额并更新版本；旧草稿首次同步清零原自动扣除，已复核及无快照明细保持不变。
- `payrollModelCalculation.ts` 将模型收入减模型扣款作为应发，管理员手填扣除后计算历史实发；固定字段覆盖时快照保留原值及修改信息。`payrollDisbursementCalculation.ts` 按应发及收入、扣款、仅记录补充项计算发放页面实发。
- `salaryModelAttendance.ts` 按模型字段配置、员工号和月份解析考勤数据，调用考勤来源并保存结果快照；员工号为空或不唯一时拒绝取数。

## 维护约束

薪资构成模型、工资批次、工资发放、工资发放记录目前暂时收尾；优化其他模块不得改变这四个模块的现有业务逻辑，除非用户提出硬性且明确的修改要求。涉及共享代码、数据或接口时保持行为兼容并验证受影响链路；详见项目根目录 `AGENTS.md` 和薪资发放开发说明。

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
