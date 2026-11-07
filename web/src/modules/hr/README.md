# hr 目录说明

## 职责

人事页面布局、共享人事 API 和子模块组合；六个页面不对应六个实体目录。

员工档案定薪页从组织架构职务目录选择员工主档职务，与定薪资料一并保存。

工资批次和工资发放使用全宽无标题、无外围卡片布局，均支持 PDF 和 XLSX 输出；工资发放可选择当月已复核批次、逐人编辑补充项并登记发放，发放后只读。记录页按批次展示汇总，可在独立页签只读查看发放快照。

## 主要内容

- 子目录：[employee-records/](employee-records/README.md)、[offboarding/](offboarding/README.md)、[onboarding/](onboarding/README.md)、[payroll/](payroll/README.md)。
- 主要文件：`api.ts`、`Hr.tsx`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
