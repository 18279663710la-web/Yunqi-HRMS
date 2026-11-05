# attendance 目录说明

## 职责

出勤绩效规则页面，支持按区间或按单位、比例/天数及出勤/缺勤组合，并兼容旧规则。

加载失败时显示错误和重试入口；读取恢复时保护未保存编辑。切换规则方式需确认并重新设置，保存配置不触发工资重算。

## 主要内容

- 主要文件：`attendanceRules.ts`、`attendanceRuleModes.ts`、`attendanceRuleLoader.ts`、`AttendanceRulesFields.tsx`、`AttendanceModeRulesFields.tsx`、`PayrollAttendanceRules.tsx`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。

## 相关文档

[项目架构约束](../../../../../AGENTS.md)、[模块约束](../../../../AGENTS.md)、[项目目录职责总览](../../../../../docs/项目目录职责说明.md)。
