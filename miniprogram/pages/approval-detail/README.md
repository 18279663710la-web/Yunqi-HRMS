# approval-detail 目录说明

## 职责

审批详情页面，展示单据、附件和流程，并提供对应操作；已发布流程的 AI 节点失败时，参与人可重试并轮询处理状态。

## 主要内容

- 主要文件：`approval-detail.json`、`approval-detail.ts`、`approval-detail.wxml`、`approval-detail.wxss`。

## 维护约束

保持 app.json 中的页面注册路径和现有跳转、分享路径；修改时同步检查 TS、WXML、WXSS 和 JSON。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
