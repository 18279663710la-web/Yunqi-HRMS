# approvals 目录说明

## 职责

审批流转、审批人配置、报销规则、AI 建议及流式处理。
新加班申请固定保存加班费，历史调休申请保持原值。
`expenseWorkflowPolicy.ts` 校验报销自定义字段和分支条件；设计稿保存时复用字段和分支重叠校验，未接入实际审批。
`customWorkflowService.ts` 按审批类型保存独立设计稿及表单、节点和条件配置，执行结构与版本校验并保护旧数据；不参与现有审批。

## 主要内容

- 主要文件：`approvalService.ts`、`customWorkflowService.ts`、`expenseAiPolicy.ts`、`expenseAiService.ts`、`expenseAiStream.ts`、`expenseApproverService.ts`、`expenseRulesService.ts`、`expenseWorkflowPolicy.ts`、`leaveRouting.ts`。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
