# modules 目录说明

## 职责

按业务分组页面、专用组件、工具和 API；审批管理的五类流程设计各自对应独立页面及全局页签。

## 主要内容

- 子目录：[admin-accounts/](admin-accounts/README.md)、[approvals/](approvals/README.md)、[attendance/](attendance/README.md)、[auth/](auth/README.md)、[dashboard/](dashboard/README.md)、[employees/](employees/README.md)、[hr/](hr/README.md)、[models-formulas/](models-formulas/README.md)、[organization/](organization/README.md)。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。员工与账号、人事管理的功能优化已完成，后续优化不得修改这两个目录，除非用户提出硬性且明确的修改要求。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
