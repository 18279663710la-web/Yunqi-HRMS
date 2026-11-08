# employee-records 目录说明

## 职责

员工档案功能区、劳动合同文件、人事事件、调岗晋升和定薪历史组件；未选择员工时禁用五个档案按钮，保存仅用于合同和定薪。调岗可调整平级组织及职务，不再输入职级，历史异动保留旧部门名称和职级。定薪提交不携带职务。

## 主要内容

- 主要文件：`EmployeeRecordsToolbar.tsx`、`employeeRecords.css`、`HrContractFiles.tsx`、`HrEvents.tsx`、`HrTransitions.tsx`、`salaryHistory.ts`、`salaryRecordPayload.ts`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。

## 相关文档

[项目架构约束](../../../../../AGENTS.md)、[模块约束](../../../../AGENTS.md)、[项目目录职责总览](../../../../../docs/项目目录职责说明.md)。
