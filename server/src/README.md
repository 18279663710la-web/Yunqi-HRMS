# src 目录说明

## 职责

服务端 TypeScript 源码，包含应用入口、双端接口、业务领域和基础设施。

## 主要内容

- 子目录：[admin/](admin/README.md)、[domains/](domains/README.md)、[miniprogram/](miniprogram/README.md)、[shared/](shared/README.md)。
- 主要文件：`app.ts`、`config.ts`、`index.ts`。

## 维护约束

保持单服务与双端代码边界，沿用统一异常处理、事务和鉴权；新业务按模块和实际职责归位。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
