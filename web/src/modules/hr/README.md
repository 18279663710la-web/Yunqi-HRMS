# hr 目录说明

## 职责

人事页面布局、共享人事 API 和子模块组合；六个页面不对应六个实体目录。

工资批次使用全宽无外围卡片布局，其他子页面沿用现有人事布局。

## 主要内容

- 子目录：[employee-records/](employee-records/README.md)、[offboarding/](offboarding/README.md)、[onboarding/](onboarding/README.md)、[payroll/](payroll/README.md)。
- 主要文件：`api.ts`、`Hr.tsx`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
