# payroll 目录说明

## 职责

薪资模型、工资计算、一键添加、考勤数据绑定、考勤与加班规则、薪资流程及相关数据访问。

## 主要内容

- 主要文件：`overtimePayrollService.ts`、`payrollAttendanceService.ts`、`payrollAutoService.ts`、`payrollModelCalculation.ts`、`payrollWorkflowRepository.ts`、`payrollWorkflowService.ts`、`salaryModelRepository.ts`、`salaryModelSchema.ts`等。
- `attendanceRuleConfig.ts` 与 `attendanceRuleConfigRepository.ts` 管理出勤绩效规则的区间/单位模式校验和存储。
- `overtimePayrollService.ts` 与 `overtimeRuleConfigRepository.ts` 负责加班绩效规则校验、计算、兼容与存储；工资明细绑定加班费时保留规则与时长快照。
- `salaryModelService.ts` 管理薪资模型读取和字段规则；`salaryModelUpdateService.ts` 处理模型变更和员工定薪同步。`payrollWorkflowService.ts` 与 `payrollWorkflowRepository.ts` 分别负责流程业务和存储。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
