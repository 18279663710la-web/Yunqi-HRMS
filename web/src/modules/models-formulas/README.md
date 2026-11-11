# models-formulas 目录说明

## 职责

模型与公式入口与子页面组合；出勤绩效规则支持按区间或单位、比例/天数及出勤/缺勤配置组合；加班绩效支持按区间或单位配置小时金额，并可通过薪资字段的独立接口弹窗绑定；公司日历维护多条作息规则供考勤组选择。
原薪资流程编辑代码保留；自定义审批流程的页面和设计稿独立位于审批管理。

## 主要内容

- 子目录：[attendance/](attendance/README.md)、[company-calendar/](company-calendar/README.md)、[onboarding-template/](onboarding-template/README.md)、[overtime/](overtime/README.md)、[payroll-workflow/](payroll-workflow/README.md)、[salary/](salary/README.md)。
- 主要文件：`ModelsFormulas.tsx`。

## 维护约束

按现有业务和子模块维护页面、专用组件及 API；保留路由、全局页签状态和既有权限边界。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
