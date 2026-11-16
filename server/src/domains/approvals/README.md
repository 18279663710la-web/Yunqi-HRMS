# approvals 目录说明

## 职责

审批流转、审批人配置、AI 建议，以及未走流程 AI 节点时读取的报销规则快照。
新加班申请固定保存加班费，历史调休申请保持原值。加班日期、开始时间和结束时间在已初始化设计稿中保持固定。同一员工提交时拒绝与本人待审批或已通过加班时段交叉的申请，校验在 `overtimeOverlap.ts`。
`expenseWorkflowPolicy.ts` 校验表单字段及分支条件。原业务字段可保存为表单字段；报销的发票附件和补充材料，以及加班的三个时间字段，在已初始化设计稿中保持固定，字段顺序用于新申请。报销自定义字段可使用附件类型，其他类型不能。字段定义需与 Web 设计器保持一致。`approvalFormFields.ts` 负责这份字段整理。
`customWorkflowService.ts` 按审批类型保存独立设计稿及表单、节点和条件配置，执行结构与版本校验并保护旧数据；未发布设计稿不改变实际审批。自定义审批不使用指定审批人。员工端审批类型列表不包含未发布的自定义审批，预览和提交也会拒绝。报销系统查验节点保存发票查重和发票验伪开关，缺省两项都做。
`customWorkflowSimulation.ts` 检查结构、模拟分支和测试 AI 地址连通性；`customWorkflowTestCases.ts`、`customWorkflowTestRunner.ts` 管理用例与测试版本；`customWorkflowPublication.ts` 保存发布快照，`customWorkflowExecutionPlan.ts` 固定单据路径。`workflowAdvance.ts` 和 `workflowAiWorker.ts` 处理顺序节点、异步 AI 建议和失败重试。
`workflowCredentials.ts` 为报销 AI 节点的 API Key 加密；密文与流程同事务保存，明文不写入流程或日志。加密密钥由环境提供或首次保存时生成在运行时目录，备份数据库时须安全保留该密钥。
`approvalSummaryService.ts` 按审批类型、日期范围和组织/职务/员工过滤汇总单据，支持按月份、组织、职务或员工分组，并对发布表单中的数字或金额字段做合计。只查 `approvals`、`employees` 等单表并显式列出字段，不使用 `SELECT *` 或 JOIN；组织和员工在内存中关联，未选择统计字段时不读取 `form_json`。
审批人候选为启用了小程序账号的员工（含职务为董事长的员工）。未匹配分支阻止提交；旧单按原时间线处理。列表、计数和详情按申请人或时间线审批人查询。已发布报销的金额分支使用发票价税合计。报销原图使用短期签名地址。`POST /api/approvals/assignees` 按当前表单预览审批人，不创建单据。

## 主要内容

- 流程设计与执行：`customWorkflowService.ts`、`approvalFormFields.ts`、`customWorkflowSimulation.ts`、`customWorkflowTestFields.ts`、`customWorkflowTestCases.ts`、`customWorkflowTestRunner.ts`、`customWorkflowPublication.ts`、`customWorkflowExecutionPlan.ts`、`workflowAdvance.ts`。
- 审批与 AI：`approvalService.ts`、`overtimeOverlap.ts`、`workflowCredentials.ts`、`workflowAiUrlProbe.ts`、`workflowAiWorker.ts`、`expenseAiPolicy.ts`、`expenseAiService.ts`、`expenseAiStream.ts`、`expenseApproverService.ts`、`expenseWorkflowPolicy.ts`。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
