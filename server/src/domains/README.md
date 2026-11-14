# domains 目录说明

## 职责

跨端业务规则和可复用服务；不是所有业务都已迁入，具体职责见下列子目录。

## 主要内容

- 子目录：[accounts/](accounts/README.md)、[approvals/](approvals/README.md)、[attendance/](attendance/README.md)、[audit/](audit/README.md)、[employees/](employees/README.md)、[invoices/](invoices/README.md)、[notices/](notices/README.md)、[onboarding/](onboarding/README.md)、[payroll/](payroll/README.md)、[u9/](u9/README.md)。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。考勤管理的功能优化已完成，后续优化不得修改 `attendance/` 中打卡、考勤组、状态、加班打卡、拜访和工资出勤取数的现有行为，除非用户提出硬性且明确的修改要求。同目录的 `companyCalendar.ts` 属于模型与公式的公司日历。模型与公式的功能优化已完成，后续优化不得修改公司日历、出勤与加班绩效规则、薪资构成模型和入职申请表模板的现有行为，除非用户提出硬性且明确的修改要求。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
