# server 目录说明

## 职责

Express 单服务工程：同时提供管理端和小程序 API，使用共享 MySQL、统一异常处理和后台任务。

## 主要内容

- 子目录：[scripts/](scripts/README.md)、[sql/](sql/README.md)、[src/](src/README.md)、[tests/](tests/README.md)、[third_party/](third_party/README.md)。
- 主要文件：`package.json`、`tsconfig.json`。

## 维护约束

保持单服务与双端代码边界，沿用统一异常处理、事务和鉴权；新业务按模块和实际职责归位。

## 常用命令

`npm run dev`、`npm run typecheck`、`npm run build`；数据库操作和冒烟脚本可能写数据。

## 相关文档

[项目架构约束](../AGENTS.md)、[模块约束](AGENTS.md)、[项目目录职责总览](../docs/项目目录职责说明.md)。
