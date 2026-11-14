# miniprogram 目录说明

## 职责

员工小程序端 API 及本端专用认证、业务入口；不负责 Web 管理员鉴权。

## 主要内容

- 子目录：[approvals/](approvals/README.md)、[attendance/](attendance/README.md)、[auth/](auth/README.md)、[business/](business/README.md)、[contacts/](contacts/README.md)、[invoices/](invoices/README.md)、[notices/](notices/README.md)、[onboarding/](onboarding/README.md)、[workbench/](workbench/README.md)。

## 维护约束

员工端入口沿用员工和董事长鉴权、入职限制及响应约定；双端共用的规则按业务归属复用。考勤管理的功能优化已完成，后续优化不得修改 `attendance/` 的现有行为，除非用户提出硬性且明确的修改要求。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
