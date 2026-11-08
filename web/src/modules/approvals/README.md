# approvals 目录说明

## 职责

五类审批通过覆盖式子侧栏进入独立页面和全局页签，提供审批人及报销规则配置组件与 API；自定义审批流程可编辑报销表单、节点及分支并保存独立设计稿，不驱动现有审批。
报销表单单选字段的选项逐项编辑和增删；保存前校验空白、重复和数量限制。

## 主要内容

- 主要文件：`api.ts`、`ApprovalManagement.tsx`、`CustomApprovalWorkflowPage.tsx`、`CustomApprovalWorkflow.tsx`、`CustomApprovalCanvas.tsx`、`CustomApprovalNodeEditor.tsx`、`ExpenseFormDesigner.tsx`、`expenseFormOptions.ts`、`customApprovalWorkflowGraph.ts`、`ExpenseApproverSettings.tsx`、`ExpenseRulesSettings.tsx`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
