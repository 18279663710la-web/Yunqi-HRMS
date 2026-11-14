# approvals 目录说明

## 职责

五类审批通过覆盖式子侧栏进入独立页面和全局页签，各页面编辑对应表单、节点及分支，按保存的测试用例测试并发布到小程序新申请；报销功能区保留 AI 规则配置入口。表单设计把原业务字段显示为可编辑字段卡片，可拖动排序。报销的发票附件和补充材料以同样的卡片展示，名称、类型和必填不可改，也不可删除。报销可添加系统查验节点，其他类型可添加发起人、审批人、条件分支和结束节点。未发布类型与历史申请仍沿用原审批逻辑。
报销表单单选字段的选项逐项编辑和增删；保存前校验空白、重复和数量限制。
流程节点配置使用弹窗，条件分支按目标节点分组设置字段、比较方式和条件值。
报销设计稿的 AI 审批节点可配置模型服务、名称、接口地址、API Key 和规则；密钥仅待保存时在页面内存中保留，服务端不回传。测试只检查 URL 连通性；实际发布后节点异步生成建议并交后续人工审批，失败等待重试，不替代已有预审规则。
独立设计稿审批人候选包含启用的董事长和员工；审批人列表在弹窗内展开并独立滚动，已发布流程可向董事长分配报销。未发布类型可在顶部指定原审批人，发布后该入口不再显示。

## 主要内容

- 主要文件：`api.ts`、`ApprovalManagement.tsx`、`CustomApprovalWorkflow.tsx`、`CustomApprovalCanvas.tsx`、`CustomApprovalNodeEditor.tsx`、`ExpenseFormDesigner.tsx`、`approvalBuiltinFields.ts`、`approvalTypeDefinitions.ts`、`expenseFormOptions.ts`、`customApprovalWorkflowGraph.ts`、`ExpenseRulesSettings.tsx`、`ApprovalTestCases.tsx`、`workflowTestCases.ts`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。表单字段及条件字段须与服务端校验同步。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
