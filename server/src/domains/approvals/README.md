# approvals 目录说明

## 职责

审批流转、审批人配置、报销规则、AI 建议及流式处理。
新加班申请固定保存加班费，历史调休申请保持原值。
`expenseWorkflowPolicy.ts` 校验自定义字段及分支条件；设计稿按审批类型提供固定字段与分支规则，并校验分支重叠；发布版本用于新申请。字段定义需与 Web 设计器保持一致。
`customWorkflowService.ts` 按审批类型保存独立设计稿及表单、节点和条件配置，执行结构与版本校验并保护旧数据；未发布设计稿不改变实际审批。
`customWorkflowSimulation.ts` 检查结构、模拟分支和测试 AI 地址连通性；`customWorkflowTestCases.ts`、`customWorkflowTestRunner.ts` 管理用例与测试版本；`customWorkflowPublication.ts` 保存发布快照，`customWorkflowExecutionPlan.ts` 固定单据路径。`workflowAdvance.ts` 和 `workflowAiWorker.ts` 处理顺序节点、异步 AI 建议和失败重试。
`workflowCredentials.ts` 为报销 AI 节点的 API Key 加密；密文与流程同事务保存，明文不写入流程或日志。加密密钥由环境提供或首次保存时生成在运行时目录，备份数据库时须安全保留该密钥。
审批人候选包含启用的董事长和员工；已发布报销流程可分配董事长，旧单保持原权限。未匹配分支阻止提交；旧单按原时间线处理。列表、计数和详情按申请人或时间线审批人查询。已发布报销的金额分支使用发票价税合计。报销原图使用短期签名地址。`POST /api/approvals/assignees` 按当前表单预览审批人，不创建单据。

## 主要内容

- 流程设计与执行：`customWorkflowService.ts`、`customWorkflowSimulation.ts`、`customWorkflowTestFields.ts`、`customWorkflowTestCases.ts`、`customWorkflowTestRunner.ts`、`customWorkflowPublication.ts`、`customWorkflowExecutionPlan.ts`、`workflowAdvance.ts`。
- 审批与 AI：`approvalService.ts`、`workflowCredentials.ts`、`workflowAiUrlProbe.ts`、`workflowAiWorker.ts`、`expenseAiPolicy.ts`、`expenseAiService.ts`、`expenseAiStream.ts`、`expenseApproverService.ts`、`expenseRulesService.ts`、`expenseWorkflowPolicy.ts`、`leaveRouting.ts`。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
