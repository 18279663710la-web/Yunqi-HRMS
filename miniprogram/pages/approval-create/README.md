# approval-create 目录说明

## 职责

审批发起页面按已发布表单的字段顺序展示。报销的发票附件和补充材料跟随该顺序；未发布报销仍放在填写项后面。
审批流转区显示具体审批人。加班申请不显示补偿方式选择，新申请固定为加班费。已发布流程使用版本化表单和分支，提交携带版本及字段值；未发布类型沿用原审批人。

## 主要内容

- 主要文件：`approval-create.json`、`approval-create.ts`、`approval-create.wxml`、`approval-create.wxss`。

## 维护约束

保持 app.json 中的页面注册路径和现有跳转、分享路径；修改时同步检查 TS、WXML、WXSS 和 JSON。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
