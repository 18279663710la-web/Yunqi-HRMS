# public — 管理后台静态资源

## 职责

存放由 Vite 原样发布到站点根目录的静态文件。

## 主要内容

- `favicon.svg`：浏览器页签图标，深色圆角块加白色立方体，图形取自 `src/components/BrandSymbol.tsx`。
- `favicon.png`：128×128 PNG 备用图标，供不支持 SVG favicon 的浏览器使用。

`index.html` 通过两个 `<link rel="icon">` 引用，SVG 优先、PNG 兜底。

## 维护约束

图标图形与管理后台品牌图形保持一致；修改 `BrandSymbol` 的路径或配色时同步更新这两个文件。不放置业务代码、构建产物或运行时数据。

## 相关文档

[项目架构约束](../../AGENTS.md)、[模块约束](../AGENTS.md)、[项目目录职责总览](../../docs/项目目录职责说明.md)。
