# tests 目录说明

## 职责

服务端、跨端单元及集成测试与测试夹具；部分集成测试创建并删除随机临时数据库。

## 主要内容

- `u9-business.integration.test.ts` 使用隔离 MySQL 和模拟 U9 校验绑定、身份隔离、应收单/收款单期间与客户过滤及客户联想、按单号返回本人表头与明细、收款单整单结算 PDF，以及 PDF 下载；`u9-money.test.ts` 校验金额精度。
- `receipt-notifications.integration.test.ts` 在隔离数据库验证 U9 回款轮询留单、重复轮询去重、按员工隔离和已读状态。
- `organizations.integration.test.ts` 在隔离数据库验证平级组织迁移、维护、员工归属及历史异动保护。
- `attendance-groups.integration.test.ts` 在隔离数据库验证考勤组创建、编辑、删除、员工迁移、公司日历必选，以及未分配员工回退第一个考勤组、无组回退初始设置对打卡、今日状态、管理端休息日和工资出勤取数的影响。
- `company-calendar.test.ts` 和 `company-calendar.integration.test.ts` 验证每周固定、大小周轮换、例外休息/上班优先级、规则 CRUD、重名/日期冲突/使用保护和权限。
- `travel-attendance.integration.test.ts` 在隔离数据库验证出差审批通过后按起止日期标记出差状态、出差日免打卡、月度汇总出差天数及工资出勤计入出差日。
- `leave-attendance.integration.test.ts` 在隔离数据库验证请假审批通过后覆盖即整天标记请假、日历休息日与出差优先于请假、免打卡及工资缺勤口径。
- `attendance-visits.integration.test.ts` 在隔离数据库验证拜访照片上传、员工隔离、照片必填、管理端按员工/关键字查询、逆地址回退及旧快捷入口迁移；`visit-geocode.test.ts` 验证腾讯地图逆地址结果解析和失败回退。
- `onboarding-attachments.integration.test.ts` 在隔离数据库验证附件归属、权限和历史；`onboarding-attachment-mini.test.ts` 模拟小程序三种选择入口。

- 子目录：[fixtures/](fixtures/README.md)。
- 主要文件：`approval-approvers.integration.test.ts`、`approval-type-approver-page.test.ts`、`attendance-api.integration.test.ts`、`attendance-policy.test.ts`、`attendance-windows.test.ts`、`employee-session-revocation.integration.test.ts`、`expense-ai-stream-client.test.ts`、`expense-ai-stream.test.ts`等。

## 维护约束

涉及数据库的测试须使用隔离测试环境；部分集成测试会创建并删除随机临时数据库。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
