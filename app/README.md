# dlient（开源版宿主 · app）

`dlient` 是一个**本地优先、插件驱动**的桌面 AI Agent 宿主。本目录是它的 **Electron 宿主**（main / preload / renderer），负责：窗口与 `dlientOpen://` 协议、插件注册与导入、Node worker 池、React 插件 UI 加载、host-api 权限校验、以及安装包的本地签名/验签。

> 仓库顶层介绍与快速上手见根目录 [README](../README.md)（中文 [README.zh-CN.md](../README.zh-CN.md)）。

## 技术栈

- **Electron**（宿主主进程 / worker utilityProcess）
- **TypeScript + Vite**（`vite-plugin-electron`：主进程、preload、渲染层统一构建）
- **React 18**：宿主渲染层（layout/setting 内置页）与插件 UI 共享同一渲染进程
- **SystemJS**：插件 UI（`remoteEntry.js`）运行时加载与共享模块解析
- npm **workspaces**：`packages/*` 为 @dlient-open 包源码直连（本地链接）

## 目录结构

```
app/
├─ packages/                 @dlient-open npm 包（源码直连 / 也可发布 npm）
│  ├─ core/                  宿主主进程核心库（池 / controller / 协议）
│  ├─ create-plugin/         插件脚手架（bin + plugin-demo 模板）
│  ├─ plugin-sdk/            createWorkerRpc、host-api 类型、vite 辅助
│  ├─ api-types/             host-api 签名单源（HostApiMap）
│  ├─ api-bridge/            UI ⇄ worker 桥（PluginApi）
│  ├─ ui/                    React 共享组件（Webview / PluginView / modal / i18n 绑定）
│  ├─ i18n/                  locale store + 文案
│  └─ native-host-sdk/       原生模块 JSON-RPC 客户端/服务端
├─ src/
│  ├─ main/                  Electron 主进程：api 表、org(签名/验签)、host-shell、
│  │                         runtime/worker 池、协议、webview-manager、nodejs 运行时
│  ├─ preload/               contextBridge：hostShell 首方通道 + 插件桥接
│  └─ renderer/              宿主 UI：layout（操作台/导入）、setting、插件视图宿主
├─ dist-electron/            主进程/preload 构建产物（gitignore）
├─ electron-builder.json5    打包配置
├─ package.json              workspaces: packages/*
└─ vite.config.ts            三端构建（main / preload / renderer）
```

周边目录（在仓库根）：`../plugins/`（示例插件，如 dsh）、`../skills/`（插件开发技能文档）。

## 本地开发

```bash
cd app
npm install        # 安装宿主依赖（workspace 链接 packages/*）
npm run dev        # 启动 Electron（热更新宿主 UI/主进程）
```

- 数据目录：`~/.dlient-open`（Windows：`%USERPROFILE%\.dlient-open`）——设置、插件、日志都在这里。
- 完整构建打包：`npm run build`（`tsc && vite build && electron-builder`）。
- 代码检查：`npm run lint`。

## 内置能力（宿主本体，非插件）

- **layout / setting / nodejs** 均为宿主内置：操作台 Console、设置页、Node.js 运行时管理（`nodejs.*` host-api）不需要插件。
- **导入 .dlient**：操作台右上「导入插件」→ 权限/依赖预览 → 安装；安装时先改写 manifest（`source=local / system=false`）再本地写 `signature.json`。
- **完整性校验**：插件启动与协议加载 UI 时校验签名（损坏/篡改 → 拒绝并提示），`@dev` 源码目录豁免。
- **深度安装**：manifest `preInstall` 依赖会自动从 npm / GitHub Release / URL 递归安装。

## 与 @dlient-open 包的关系

- 开发期：宿主经 npm workspaces `packages/*` 直接使用源码（`devDependencies: "*"`），改包即生效，无需发布。
- 发布期：这些包同时可 `npm publish`（已在官方源发布 `0.1.0`），供外部插件/脚手架引用。

## 许可证

[MIT](../LICENSE) © 2026 dlient contributors
