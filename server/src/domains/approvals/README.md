# approvals 目录说明

## 职责

审批流转、审批人配置、报销规则、AI 建议及流式处理。
新加班申请固定保存加班费，历史调休申请保持原值。
`expenseWorkflowPolicy.ts` 是报销自定义流程的规则验证基础：检查字段、审批人和分支重叠，并拒绝未匹配分支；目前未接入配置接口、发起或审批流程。

## 主要内容

- 主要文件：`approvalService.ts`、`expenseAiPolicy.ts`、`expenseAiService.ts`、`expenseAiStream.ts`、`expenseApproverService.ts`、`expenseRulesService.ts`、`expenseWorkflowPolicy.ts`、`leaveRouting.ts`。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
