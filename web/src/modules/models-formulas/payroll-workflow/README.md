# payroll-workflow 目录说明

## 职责

复用原薪资流程画布展示自定义审批流程页面；功能区使用可搜索下拉框选择五种审批类型，当前仅保存页面内状态，不读取或保存审批流程。原薪资流程编辑代码保留但不再作为页面入口。

## 主要内容

- 主要文件：`CustomApprovalWorkflow.tsx`、`PayrollWorkflow.tsx`、`PayrollWorkflowCanvas.tsx`、`PayrollWorkflowIcons.tsx`、`workflowUtils.ts`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。

## 相关文档

[项目架构约束](../../../../../AGENTS.md)、[模块约束](../../../../AGENTS.md)、[项目目录职责总览](../../../../../docs/项目目录职责说明.md)。
