# admin 目录说明

## 职责

Web 管理端接口与仅管理端使用的服务；`adminRoutes.ts` 聚合主要管理路由，`adminContext.ts` 读取管理员上下文。

## 主要内容

- 子目录：[admin-accounts/](admin-accounts/README.md)、[approvals/](approvals/README.md)、[attendance/](attendance/README.md)、[dashboard/](dashboard/README.md)、[employees/](employees/README.md)、[hr/](hr/README.md)、[models-formulas/](models-formulas/README.md)。
- 主要文件：`adminContext.ts`、`adminRoutes.ts`。

## 维护约束

管理端入口沿用管理员鉴权与权限校验；跨端规则按实际归属复用共享业务，不复制实现。员工与账号、人事管理的功能优化已完成，后续优化不得修改这两个目录中对应模块的现有行为，除非用户提出硬性且明确的修改要求。同目录里的组织目录、职务目录不因此整文件冻结。考勤管理的功能优化已完成，后续优化不得修改 `attendance/` 的现有行为，除非用户提出硬性且明确的修改要求。模型与公式的功能优化已完成，后续优化不得修改 `models-formulas/`，以及人事路由中的出勤规则、加班规则和薪资模型接口，除非用户提出硬性且明确的修改要求。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
