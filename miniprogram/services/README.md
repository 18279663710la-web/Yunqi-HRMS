# services 目录说明

## 职责

小程序 API 与业务入口；请求由 `utils/request.ts` 统一封装。

## 主要内容

- 子目录：[approvals/](approvals/README.md)、[attendance/](attendance/README.md)、[auth/](auth/README.md)、[business/](business/README.md)、[contacts/](contacts/README.md)、[invoices/](invoices/README.md)、[notices/](notices/README.md)、[onboarding/](onboarding/README.md)、[workbench/](workbench/README.md)。

## 维护约束

按业务调用统一请求封装；保持员工登录态、错误处理和既有接口契约。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
