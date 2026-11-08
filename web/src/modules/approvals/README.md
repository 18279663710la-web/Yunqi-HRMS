# approvals 目录说明

## 职责

五类审批通过覆盖式子侧栏进入独立页面和全局页签，各页面直接编辑对应表单、节点及分支并保存独立设计稿，不驱动现有审批；报销功能区保留 AI 规则配置入口。报销可添加系统查验节点，其他类型可添加发起人、审批人、条件分支和结束节点。原后台审批人设置页面已移除，实际审批仍使用原有配置。
报销表单单选字段的选项逐项编辑和增删；保存前校验空白、重复和数量限制。
流程节点配置使用弹窗，条件分支按目标节点分组设置字段、比较方式和条件值。
报销设计稿的 AI 审批节点可配置模型服务、名称、接口地址、API Key 和规则；密钥仅待保存时在页面内存中保留，服务端不回传。节点不执行实际审批，也不替代已有预审规则。
独立设计稿审批人候选包含启用的董事长和员工；审批人列表在弹窗内展开并独立滚动，不改变现有审批权限。

## 主要内容

- 主要文件：`api.ts`、`ApprovalManagement.tsx`、`CustomApprovalWorkflow.tsx`、`CustomApprovalCanvas.tsx`、`CustomApprovalNodeEditor.tsx`、`ExpenseFormDesigner.tsx`、`approvalTypeDefinitions.ts`、`expenseFormOptions.ts`、`customApprovalWorkflowGraph.ts`、`ExpenseRulesSettings.tsx`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。审批类型固定字段及条件字段须与服务端校验同步。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
