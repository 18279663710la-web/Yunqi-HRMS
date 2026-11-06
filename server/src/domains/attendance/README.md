# attendance 目录说明

## 职责

考勤规则、打卡数据、设置和加班打卡；供员工端及管理端复用，并按工资月份提供考勤和计费加班数据。

## 主要内容

- 主要文件：`attendancePolicy.ts`、`attendanceService.ts`、`attendanceSettings.ts`、`overtimeAttendanceService.ts`、`payrollAttendanceSource.ts`（按员工和工资月份读取考勤项目）。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
