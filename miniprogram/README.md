# miniprogram 目录说明

## 职责

原生微信小程序工程，提供员工页面、组件、业务接口封装和微信平台配置。

## 主要内容

- 子目录：[components/](components/README.md)、[custom-tab-bar/](custom-tab-bar/README.md)、[lib/](lib/README.md)、[pages/](pages/README.md)、[services/](services/README.md)、[subpackages/](subpackages/README.md)、[types/](types/README.md)、[utils/](utils/README.md)。
- 主要文件：`app.json`、`app.ts`、`app.wxss`、`package.json`、`sitemap.json`、`tsconfig.json`。

## 维护约束

沿用原生微信小程序组件及请求封装；保留现有页面路径与鉴权、入职引导行为。

## 常用命令

`npm run typecheck`；微信开发者工具打开项目根目录编译。

## 相关文档

[项目架构约束](../AGENTS.md)、[模块约束](AGENTS.md)、[项目目录职责总览](../docs/项目目录职责说明.md)。
