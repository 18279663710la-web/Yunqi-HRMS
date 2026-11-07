# utils 目录说明

## 职责

请求和登录态、工资条与业务 PDF 受鉴权下载、流式处理、发票与二维码、请假时长等工具。

## 主要内容

- 主要文件：`apiOrigin.ts`、`expense-ai-stream.ts`、`invoice-identity.ts`、`invoice-precheck.ts`、`leave-duration.ts`、`qr-image.ts`、`request.ts`、`util.ts`。

## 维护约束

沿用原生微信小程序组件及请求封装；保留现有页面路径与鉴权、入职引导行为。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
