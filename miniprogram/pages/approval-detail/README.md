# approval-detail 目录说明

## 职责

审批详情页面，展示单据、附件和审批结果，并提供对应操作。申请人且非流程参与人视角不展示审批时间线与当前节点（服务端裁剪 `flowVisible=false`），仅显示最终状态；被驳回时显示"审批意见"卡片。时间线上的审批人视角保留完整流程。已发布流程的 AI 节点自动失败三次后跳过并进入下一人工审批；此前已停在失败状态的任务仍可重试并轮询处理状态。

## 主要内容

- 主要文件：`approval-detail.json`、`approval-detail.ts`、`approval-detail.wxml`、`approval-detail.wxss`。

## 维护约束

保持 app.json 中的页面注册路径和现有跳转、分享路径；修改时同步检查 TS、WXML、WXSS 和 JSON。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
