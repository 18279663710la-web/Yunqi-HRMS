# tests 目录说明

## 职责

服务端、跨端单元及集成测试与测试夹具；部分集成测试创建并删除随机临时数据库。

## 主要内容

- `u9-business.integration.test.ts` 使用隔离 MySQL 和模拟 U9 校验绑定、身份隔离与 PDF 下载；`u9-money.test.ts` 校验金额精度。
- `organizations.integration.test.ts` 在隔离数据库验证平级组织迁移、维护、员工归属及历史异动保护。
- `onboarding-attachments.integration.test.ts` 在隔离数据库验证附件归属、权限和历史；`onboarding-attachment-mini.test.ts` 模拟小程序三种选择入口。

- 子目录：[fixtures/](fixtures/README.md)。
- 主要文件：`approval-approvers.integration.test.ts`、`approval-type-approver-page.test.ts`、`attendance-api.integration.test.ts`、`attendance-policy.test.ts`、`attendance-windows.test.ts`、`employee-session-revocation.integration.test.ts`、`expense-ai-stream-client.test.ts`、`expense-ai-stream.test.ts`等。

## 维护约束

涉及数据库的测试须使用隔离测试环境；部分集成测试会创建并删除随机临时数据库。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
