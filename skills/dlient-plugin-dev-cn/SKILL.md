***

name: dlient-plugin-dev-cn
description: 为 dlient 桌面宿主开发插件。覆盖 @dlient-open/create-plugin 脚手架、插件 manifest 结构、Worker（utilityProcess）与 UI（SystemJS remoteEntry）编写、宿主 API 调用、沙箱与权限模型。创建、构建、调试或分发 dlient 插件时使用。
------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# dlient 插件开发

## 1. 概述

dlient 是基于 Electron 的桌面宿主，可加载第三方插件。插件由两半组成（均可选）：

- **Worker**：运行在宿主托管的 Electron `utilityProcess`（Node 运行时，无 DOM、无渲染层）中，由宿主 **worker 池** 管理；

- **UI**：以 `System.register` 编译的 React 产物（`remoteEntry.js`），由宿主渲染层经 SystemJS 加载。

三条核心设计原则：

1. **沙箱优先**：每个 worker 都以 Node Permission Model 启动（`--permission` + 最小 `--allow-fs-read`），不能 fork 子进程、不能加载 `.node`、不能直接读写文件系统。
2. **宿主代理**：worker 需要的一切（文件、网络、对话框、子进程、系统 API）都经 **host-api** 调用，主进程对每次调用做校验。
3. **权限模型**：方法级权限（`manifest.permissions` 声明）+ 资源级授权（路径 / URL / 命令，用户运行时确认）。

## 2. 适用场景

- **本地分发插件**：把插件打成 **`.dlient`** 包共享 / 导入。开源版宿主**无插件市场、无服务端、无线上发布**——分发与安装只走本地。

- 开发与迭代**仓库 dev 源码目录**里的插件（`dlient-open/plugins/<id>`，`source: 'dev'`），或**本地导入**（`source: 'local'`，装入宿主 `plugins/` 目录）。

- **导入本地插件** 自用（宿主操作台 →「导入插件」→ 选择 `.dlient`）。

- **调试与排障**：worker 日志、权限拒绝、host-api 错误、热重载（产物级 watch）。

## 3. 核心概念

| 概念       | 含义                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest | `package.json` 的 `dlient` 子对象：声明身份、类型、UI/worker 形态、权限、目录、命令、暴露方法。                                                                                       |
| Worker 池 | 宿主以池方式拉起 worker。`workerMode: 'solo'`（或 `source: 'dev'`）→ 独占池（一插件一进程）；默认 `shared` 归组低敏感插件。                                                               |
| Host-api | 主进程暴露的 RPC 面：`rpc.fs.read(path)`。每次调用都过「方法权限 + 资源白名单」。                                                                                                  |
| 权限模型     | 进程级封禁（`--permission`，禁 child-process/addon/fs-write）+ 资源级授权（`fs-grants` / `net-grants` / `spawn-grants` / 会话 / 临时）。详见 `references/permission-model.md`。 |
| 原生模块     | `.node` 不能进 worker。用 `native`（随包内置，逐平台）或 `nativeModules`（用户侧安装）——都跑在专用全权限 Node 子进程（native-host）中。详见 `references/native-host.md`。                        |

## 4. 插件开发流程

1. **脚手架**：`npx @dlient-open/create-plugin my-plugin`。生成 `my-plugin/` 模板。
2. **安装与构建**：`cd my-plugin && npm install && npm run build`（UI → `dist/remoteEntry.js` + assets；worker → `dist/worker.js`）。
3. **开发 Worker**：改 `src/main/index.ts`（可选）。
4. **开发 UI**：改 `src/renderer/App.tsx` + `i18n.ts` + `styles.css`（可选）。
5. **运行与调试**——对着开源宿主迭代：

   - dev 流程：把插件放进仓库 dev 源码目录（`dlient-open/plugins/<插件id>`），执行 `npm run dev`——watch 产物（`vite build --watch` + worker esbuild `--watch`）；产物变更后重开 / 重载宿主生效（无 dev server 端口）。

   - 类发布流程：执行 `npm run pack` 生成 `.dlient`，在宿主操作台「导入插件」导入（确认框 → 深度安装）。

   - 日志在 `USER_DATA/plugin-data/<插件id>/logs/main.log`（`USER_DATA` = `~/.dlient-open`）。

CLI 参数、模板树与细节见 `references/create-plugin.md`。

## 5. Manifest 编写指南

Manifest 即 `package.json` 的 `dlient` 对象。必填字段：

- `name` 与 `description` —— 字符串或多语言映射 `{ default, "zh-CN", "en-US" }`；**两者必填**。

- `icon` —— **必填**字符串路径（如 `assets/icon.svg`）。

常用字段：

| 字段               | 作用                                            | 默认                                          |
| ---------------- | --------------------------------------------- | ------------------------------------------- |
| `type`           | `app` / `full` / `worker` / `ui`              | `app`                                       |
| `version` / `id` | 身份                                            | 回退到顶层 `package.json`                        |
| `dist`           | 相对插件根的产物目录                                    | `dist`                                      |
| `permissions`    | 申请的宿主能力（如 `fs.read`、`child.spawn`）            | —                                           |
| `platforms`      | 简单数组：六个 OS.arch 组合之一（`win32.x64` … `linux.arm64`） | 全平台                                 |
| `workerMode`     | `shared` / `solo`                             | `shared`                                    |
| `source`         | `local` / `dev`（开源版无 `market`；导入强制 `local`、`system=false`） | `local`            |
| `nodeVersion`    | 最低 Node 版本（如 `"22"`）；触发宿主就绪门控与内置运行时安装       | —                                           |
| `preInstall`     | 安装期依赖映射 `{ 插件id: "0.5.1" \| github 仓库 URL \| .dlient URL }`——导入/安装时深度安装 | —              |
| `expose`         | 其它插件可调用的方法（每项可带 `access` + `paramsSchema`）    | —                                           |

完整字段速查表与带注释示例见 `references/manifest-schema.md`。

## 6. 调用宿主（host-api）

Worker 侧：

```ts
import { createWorkerRpc } from '@dlient-open/plugin-sdk'

const rpc = createWorkerRpc('my-plugin')

const text = await rpc.fs.read('C:/tmp/a.txt')        // 需要 fs.read
await rpc.fs.write('C:/tmp/out.bin', { base64: '…' }) // 需要 fs.write
const p = await rpc.app.getPath('userData')           // 无需权限
```

分组速览：

- **fs.\*** — read / write / delete / stat / listDir / watch（宿主按路径白名单强制）；

- **net.\*** — fetch / request（URL 授权）、`net.isOnline`、`net.getFreePort`、`net.probePort`；

- **dialog.\*** — `showOpenDialog(permissions, options, description?)`、`showSaveDialog(options)`、`showMessageBox(options)`；

- **child.\*** — `spawn` / `execFile`（SDK 封装返回 `ChildHandle`，句柄 kill / stdin / 事件），宿主代 spawn，命令白名单 + 参数规则；

- **nodejs.\*** — 内置 Node.js 运行时（checkLocal / checkBundled / resolveRuntime / install）。`nodejs` **不是插件**：运行时内置在宿主主进程，需在 `manifest.permissions` 声明 `nodejs.*`（不再有 `plugin.invoke('nodejs', …)`）；

- **app.\*** — data（隔离存储）、window、menu、shortcut、crypt、notify、getPath 等；

- **webview.\*** — create / update / destroy / setVisible / showWebviewByPlugin / hideWebviewByPlugin / webContentsCall（worker 通道）；

- **clipboard / os / notification / log / permission** — 薄封装；

- **plugin.install** — 从 .dlient 路径 / npm / GitHub Release / URL 安装插件；宿主先弹用户确认框，含 preInstall 深度安装（worker 通道、dangerous）；

- **plugin.invoke** 与 **rpc.plugin.invoke** — 调用其它插件的 expose 方法。

逐方法的完整文档（参数、类型、示例）见 `references/host-api-reference.md`。

## 7. 权限

- **静态（声明式）**：在 `manifest.permissions` 列能力（如 `fs.read`、`child.spawn`），在 `fsDirs` / `spawnCmds` 列资源；安装时用户确认。

- **运行时（交互式）**：插件首次触碰白名单外资源时，宿主弹统一授权框：

  - `fs-access` —— 授权文件/目录（来自 `dialog.showOpenDialog`）；

  - `net-access` —— 授权 URL/域名；

  - `spawn-confirm` —— 授权命令；

  - `runtime-confirm` —— 授权跨插件方法调用。

- 每个弹框提供**作用域**：始终允许（持久）/ 仅本次（会话）/ 拒绝。

- **批量**：`permission.request(resources[])` 一次弹框授权多项。

- 开发期逃生开关（勿用于生产）：`DLIENT_DISABLE_PERMISSION=1`、`DLIENT_DISABLE_FS_ENFORCE=1`。

完整模型（进程封禁、授权表、弹框流、spawn 参数规则、审计日志）见 `references/permission-model.md`。

## 8. 开发规范

- Worker 规范（禁止同步阻塞、日志、结构化错误、子进程句柄）与 UI 规范（使用 `@dlient-open/ui`（shadcn 风格）组件与图标、i18n、主题）：`references/dev-standards.md`。

## 9. 参考文件

| 文件                                 | 用途                                                 |
| ---------------------------------- | -------------------------------------------------- |
| `references/create-plugin.md`      | 脚手架、模板目录树、开发流程、构建与产物 watch、调试、本地 .dlient 打包与导入 |
| `references/manifest-schema.md`    | manifest 完整字段参考与带注释示例                              |
| `references/host-api-reference.md` | 逐方法的宿主 API 文档：参数、类型、示例                             |
| `references/permission-model.md`   | 进程沙箱 + 资源授权 + 统一确认弹框                               |
| `references/native-host.md`        | 原生模块 native-host 模式：架构、server 与 client、可重启 host、安全 |
| `references/worker.md`             | Worker 编写：SDK API、RPC、日志、子进程句柄、跨插件调用               |
| `references/ui.md`                 | UI 编写：`@dlient-open/ui` 共享组件、hooks、i18n、主题          |
| `references/dev-standards.md`      | Worker + UI 开发规范                                   |

