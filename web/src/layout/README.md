# layout 目录说明

## 职责

主侧栏、子栏目、路由展示、工作区页签及相关状态；人事管理、模型与公式和审批管理使用覆盖式子栏目。
五类审批流程分别使用审批管理子模块及页签，旧自定义审批流程和薪资流程页面路由跳转到请假审批。

## 主要内容

- 主要文件：`AdminLayout.tsx`、`AdminPageRoutes.tsx`、`AdminTheme.tsx`、`subModules.tsx`、`WorkspaceContext.ts`、`workspaceTabs.ts`。
- `AdminTheme.tsx`：界面主题（深色/浅色）状态、localStorage 持久化和 antd 主题配置；浅色时在 html 根元素加 `admin-theme-light`，配套覆盖样式位于 `src/styles.css` 末尾。

## 维护约束

沿用 React、现有路由、Ant Design 和共享请求封装；按业务模块组织新增页面和组件。主题切换只改变配色，不改变布局、字体和结构；新增含深色硬编码的样式时，需在 `styles.css` 的 `html.admin-theme-light` 覆盖段补充对应浅色值。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
