# admin-accounts 目录说明

## 职责

管理员登录、鉴权、会话、密码和管理员账号管理。

## 主要内容

- 主要文件：`adminAuthService.ts`、`authMiddleware.ts`、`routes.ts`、`sessionRoutes.ts`。

## 维护约束

管理端入口沿用管理员鉴权与权限校验；跨端规则按实际归属复用共享业务，不复制实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
