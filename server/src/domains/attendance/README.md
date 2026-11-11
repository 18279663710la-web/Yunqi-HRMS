# attendance 目录说明

## 职责

考勤规则、打卡数据、设置和加班打卡；供员工端及管理端复用，并按工资月份提供考勤和计费加班数据。

## 主要内容

- 主要文件：`attendancePolicy.ts`、`attendanceService.ts`、`attendanceSettings.ts`、`attendanceGroups.ts`、`overtimeAttendanceService.ts`、`payrollAttendanceSource.ts`（按员工和工资月份读取考勤项目）。
- 默认考勤设置保存在 `attendance_settings`；其他考勤组独立保存同一套时段、休息日期和打卡点，成员通过 `attendance_group_employees` 只归属一个组，未分配员工回退默认设置。员工端、管理端及工资取数均按员工读取实际生效的组设置。
- 工资出勤统计仅计完整的普通上下班卡，单卡计 0 出勤天并参与缺勤绩效；考勤页面和小程序继续使用原来的单卡状态与汇总。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
