# approval-create 目录说明

## 职责

审批发起页面，支持五类申请、报销材料及手动 AI 预审。
加班申请不显示补偿方式选择，新申请固定为加班费。

## 主要内容

- 主要文件：`approval-create.json`、`approval-create.ts`、`approval-create.wxml`、`approval-create.wxss`。

## 维护约束

保持 app.json 中的页面注册路径和现有跳转、分享路径；修改时同步检查 TS、WXML、WXSS 和 JSON。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
