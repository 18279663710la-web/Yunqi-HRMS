# payslips 目录说明

## 职责

员工本人已接收的工资条列表，通过受鉴权下载打开 PDF，并使用微信查看器菜单保存或分享。

## 主要内容

- `payslips.ts`、`payslips.wxml`、`payslips.wxss`、`payslips.json`：列表、状态和交互。

## 维护约束

只访问本人已发送工资条；登录态、下载和已读版本沿用 `services/workbench/payslips.ts` 与统一请求封装。

## 相关文档

[项目架构约束](../../../AGENTS.md)、[模块约束](../../AGENTS.md)、[项目目录职责总览](../../../docs/项目目录职责说明.md)。
