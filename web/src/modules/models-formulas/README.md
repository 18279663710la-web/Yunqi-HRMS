# models-formulas 目录说明

## 职责

模型与公式入口与子页面组合；出勤绩效规则支持按区间或单位、比例/天数及出勤/缺勤配置组合；加班绩效支持按区间或单位配置小时金额，并可通过薪资字段的独立接口弹窗绑定；公司日历维护多条作息规则供考勤组选择。
自定义审批流程的页面和设计稿独立位于审批管理。旧薪资流程地址仍跳转到请假审批。

## 主要内容

- 子目录：[attendance/](attendance/README.md)、[company-calendar/](company-calendar/README.md)、[onboarding-template/](onboarding-template/README.md)、[overtime/](overtime/README.md)、[salary/](salary/README.md)。
- 主要文件：`ModelsFormulas.tsx`。

## 维护约束

模型与公式功能优化已完成，后续优化不得修改本目录的页面、接口和行为，除非用户提出硬性且明确的修改要求。离职申请表设置已删除。详见项目根目录 `AGENTS.md`。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
