# tests 目录说明

## 职责

Web 组件、模型、工具及工作区页签测试；当前 `package.json` 未定义单独测试脚本。

## 主要内容

- 主要文件：`attendance-rules-view.test.tsx`、`attendance-rules.test.ts`、`hr-contract-files-view.test.tsx`、`hr-contract-upload.test.ts`、`hr-modules.test.ts`、`hr-payroll-pages.test.tsx`、`models-formulas-page.test.tsx`、`onboarding-archive-view.test.tsx`等。
- `onboarding-attachments-view.test.tsx` 覆盖普通字段和表格子字段的附件展示。
- `employee-salary-payload.test.ts` 验证定薪提交不会携带旧职务。
- `employee-records-toolbar.test.tsx` 验证未选员工时档案按钮禁用及保存的可用范围。

## 维护约束

测试应覆盖用户可见行为及相关业务边界；涉及服务端写入时使用隔离测试环境。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
