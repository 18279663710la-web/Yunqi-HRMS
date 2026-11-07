# workbench 目录说明

## 职责

公司信息、工作台快捷入口、待办统计、演示数据重置及员工本人工资条查询、鉴权下载和已读接口。

## 主要内容

- 主要文件：`companyRoutes.ts`、`demoRoutes.ts`、`statsService.ts`、`todoRoutes.ts`、`payslipRoutes.ts`。

## 维护约束

员工端入口沿用员工和董事长鉴权、入职限制及响应约定；双端共用的规则按业务归属复用。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
