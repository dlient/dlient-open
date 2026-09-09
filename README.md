<div align="center">

# dlient — Open Edition

**A local-first, plugin-based AI-agent desktop host.**
在本地运行由插件驱动的 AI Agent 工作台：插件即能力，导入即安装。

```
Electron Host · Node 插件 Worker · React 插件 UI · 本地导入 · 无服务端
```

> [!NOTE]
> 本仓库是 dlient 的**开源版（无服务端/无账号/无市场）**。闭源版的网络服务、登录与插件市场不在此仓库中。
> This repository is the **open-source edition** of dlient (no server, no accounts, no plugin marketplace).

</div>

---

## Navigation

- **EN:** [What is it](#what-is-it) · [Features](#features) · [Architecture](#architecture) · [Quick Start](#quick-start) · [Plugin Development](#plugin-development) · [Roadmap](#roadmap) · [Contributing](#contributing) · [License](#license)
- **中文:** [这是什么](#这是什么) · [功能特性](#功能特性) · [架构](#架构) · [快速开始](#快速开始) · [插件开发](#插件开发) · [路线图](#路线图) · [如何参与](#如何参与) · [许可证](#许可证)

---

## What is it

`dlient` 是一个开源的桌面 AI Agent 工作台。它本身只做三件事：**装插件、跑插件、连在一起**。

> dlient is an open-source desktop host for AI-agent tools. Plugins bring the capabilities — a worker half runs in a sandboxed Node process, a UI half is loaded into the host as a React bundle, and the host brokers every privileged call through a permission-checked host-api.

Unique to this edition:

- **Plugin-first**: a plugin is one `.dlient` package containing a Node worker and/or a React UI.
- **No cloud required**: everything runs and persists locally under `~/.dlient-open`.
- **Import-to-run**: install a plugin by importing a `.dlient` file — the host shows exactly which permissions and dependency plugins it requests before installing.
- **Deep install**: a plugin can declare `preInstall` dependencies that are resolved automatically from npm, a GitHub Release, or a direct `.dlient` URL.
- **Local integrity signing**: every installed package is signed locally and re-verified at boot / when its UI loads, so a corrupted or tampered plugin is refused with a clear message.

---

## Features

| Area | Details |
| --- | --- |
| Plugin runtime | Node worker pool + React UI (`SystemJS` `remoteEntry`) with keep-alive pages |
| Permission model | Method-level `manifest.permissions` (risk-labelled `default / warn / dangerous`), resource path checks, UI whitelist |
| Import review | Dialog with **Permissions** and **Dependencies** tabs before anything is written |
| Built-in runtime | `nodejs.*` host-api (probe / resolve / install a bundled Node.js LTS) — no plugin required |
| Deep install | `preInstall`: npm semver → package root/`dist`/`pack` `.dlient` · GitHub latest-Release asset · direct URL |
| Plugin-driven install | `rpc.plugin.install({ id, kind, source, description })` — host asks the user first |
| Integrity | Local Ed25519 `signature.json` (same format as the closed edition) written on install, verified at startup & protocol load; `@dev`/dev sources exempt |
| Appearance sync | Host language/theme can drive embedded web apps (e.g. dsh writes `~/.dsh/settings.yaml`) |
| Local-first | Settings, plugins, logs under `~/.dlient-open`; no accounts, no telemetry server |

### Example UI

We keep a real screenshot in `docs/` (to be added). Meanwhile, here is the data-flow picture:

```
 .dlient ──► import review (Permissions / Dependencies tabs)
                │ confirm
                ▼
        unpack → patch manifest (source=local, system=false)
                │
                ├─► preInstall deps: npm / GitHub Release / URL  (recursive, dedup)
                │
                └─► write local signature.json (package.json + dist/**)
                ▼
   launch: worker (Node pool)  ·  UI (React in host)  ·  host-api gated by permissions
```

---

## Architecture

```
dlient-open/
├─ app/                 Electron host (main / preload / renderer)
│  ├─ packages/         @dlient-open npm packages (source-linked)
│  │   ├─ core/         pool / controller / protocol (host-internal)
│  │   ├─ plugin-sdk/   createWorkerRpc, host-api typing, vite helpers
│  │   ├─ api-types/    single source of host-api signatures (HostApiMap)
│  │   ├─ api-bridge/   UI ⇄ worker bridge
│  │   ├─ ui/           shared React components (Webview, PluginView, …)
│  │   ├─ i18n/         locale provider + bundles
│  │   └─ native-host-sdk/   JSON-RPC client/server for native modules
│  └─ src/main/         api tables, org (sign/verify), host-shell, runtime, …
├─ packages/
│  └─ create-plugin/    scaffolding: npx @dlient-open/create-plugin
├─ plugins/
│  └─ dsh/              sample plugin (DeepSeek Harness web UI)
├─ scripts/             make-dlient.mjs (unsigned .dlient packer)
└─ skills/              plugin-development skills (en + zh-CN)
```

- **Main process**: window, `dlientV3://` protocol, plugin registry, host-api executor, permission checks, local signing/verify.
- **Worker**: forked Node process per plugin (solo or shared pool). Never talks to the OS directly — every privileged action goes through host-api.
- **UI**: React rendered in the host renderer; plugin bundles are loaded by SystemJS and share `@dlient-open/ui` / `@dlient-open/i18n`.
- **Built-in pages**: Console（操作台）、Settings — `layout` / `setting` / `nodejs` live in the host, not as plugins.

---

## Quick Start

### 1. Run the host from source

```bash
git clone <this-repo> dlient-open
cd dlient-open/app
npm install
npm run dev          # starts Electron with the host UI
```

> [!NOTE]
> First-run data lives in `~/.dlient-open` (Windows: `%USERPROFILE%\.dlient-open`).

### 2. Install a plugin (≤ 60 s)

1. Click **导入插件 (Import plugin)** in the Console header.
2. Pick a `.dlient` package (e.g. the bundled `plugins/dsh/dsh-0.1.0.dlient` after building it — see below).
3. Review the **Permissions / Dependencies** tabs, confirm, and the plugin opens.

### 3. Try the sample plugin

```bash
cd dlient-open/plugins/dsh
npm install
npm run pack         # produces dsh-0.1.0.dlient
```

Then import that file in the host. `dsh` needs Node.js ≥ 22 — the host resolves it automatically (bundled LTS or your local `node`).

### Detailed guides

- Plugin manifest, host-api and permission model: `skills/` (en: `dlient-plugin-dev`, zh-CN: `dlient-plugin-dev-cn`).
- Scaffolding: `npx @dlient-open/create-plugin my-plugin` (see `packages/create-plugin/README.md`).

---

## Plugin Development

A plugin is a `package.json` with a `dlient` manifest plus a worker (`src/main`) and/or UI (`src/renderer`).

```jsonc
{
  "name": "my-plugin",
  "dlient": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "0.1.0",
    "type": "app",                 // app | full | worker | ui
    "icon": "assets/icon.svg",
    "permissions": ["child.spawn", "net.getFreePort", "log.write"],
    "nodeVersion": "22",
    "preInstall": {                // deep install dependencies (optional)
      "helper-a": "0.5.1",
      "helper-b": "https://github.com/owner/helper-b",
      "helper-c": "https://example.com/helper-c.dlient"
    }
  }
}
```

- **Worker** API: `import { createWorkerRpc } from '@dlient-open/plugin-sdk'`; call the host with `rpc.fs.* / rpc.child.* / rpc.nodejs.* / rpc.plugin.*` …
- **UI**: build with React + `@dlient-open/ui`; embed remote pages with the `Webview` component.
- **Pack**: `npm run pack` (uses the local `script/make-dlient.mjs`) → unsigned `.dlient`; the host signs it locally on install.

> [!WARNING]
> The open edition does **not** ship a verified plugin store. Installing a plugin means trusting the `.dlient` you import: it runs under the permissions you approve in the import dialog.

---

## Roadmap

- [x] Local plugin import with permission/dependency review
- [x] `nodejs.*` built-in runtime host-api (no plugin needed)
- [x] `preInstall` deep install (npm / GitHub Release / direct URL)
- [x] `plugin.install` with user confirmation
- [x] Local integrity signing + verify at boot / protocol load
- [x] Host language/theme → embedded web app sync (dsh `settings.yaml`)
- [x] Open-source plugin-development skills (en + zh-CN)
- [ ] Prebuilt binaries for Windows / macOS / Linux
- [ ] Plugin templates & richer sample plugins
- [ ] Automated tests & CI for the host and plugins
- [ ] Visual docs/screenshots in `docs/`

---

## Contributing

Bug reports and feature requests: open an issue with steps to reproduce (host logs live under `~/.dlient-open/plugin-data/<pluginId>/logs/`).

Code contributions are welcome:

1. Fork and clone the repo; develop the host under `app/`, plugins under `plugins/`.
2. Run `npm run build` in the host and `npm run build` in any changed plugin before finishing (source ↔ dist must stay in sync).
3. Keep the security invariants: plugin workers never bypass host-api permission checks; `@dlient/core` is source-linked only, never published to npm.
4. Open a pull request and describe what changed and why.

See `CONTRIBUTING.md` (planned) for the full guide.

---

## License

The license for this repository is not yet decided. A `LICENSE` file will be added before first public release — until then all rights reserved by the project.

---

# 这是什么

`dlient` 是一个开源的**桌面 AI Agent 插件宿主**。宿主本身只做三件事：装插件、跑插件、把它们连起来。插件由一个 `.dlient` 包组成，可含两部分：

- **worker**：运行在受沙箱约束的 Node 进程中（无 DOM、无渲染层）；
- **UI**：React 打包成 SystemJS `remoteEntry.js`，由宿主渲染层加载。

本版（开源版）特点：

- **插件优先**：能力全部来自插件；
- **完全本地**：无需云服务，数据落在 `~/.dlient-open`；
- **导入即用**：导入 `.dlient` 前会先展示其**权限**与**依赖**；
- **深度安装**：插件可声明 `preInstall` 依赖（npm / GitHub Release / 直链 URL），安装时自动递归解析；
- **本地完整性签名**：安装时本地生成 `signature.json`，启动与 UI 加载时校验，损坏/被篡改的插件会被拒绝并给出明确提示。

---

# 功能特性

| 领域 | 说明 |
| --- | --- |
| 插件运行时 | Node worker 池 + React UI（SystemJS remoteEntry），页面 keep-alive 不销毁 |
| 权限模型 | manifest.permissions 方法级权限（风险分级 default/warn/dangerous）+ 路径/白名单校验 |
| 导入确认 | 导入前弹框，分「权限」「依赖」两个 tab |
| 内置运行时 | `nodejs.*` host-api（探测/解析/安装内置 Node.js LTS），无需 nodejs 插件 |
| 深度安装 | `preInstall`：npm semver（包根/dist/pack 找 .dlient）· GitHub 最新 Release 资产 · URL 直链 |
| 插件驱动安装 | `rpc.plugin.install({id, kind, source, description})`，宿主先弹用户确认 |
| 完整性 | 安装时本地 Ed25519 写 `signature.json`（格式与闭源版一致），启动/协议加载校验；@dev 源码跳过 |
| 外观同步 | 宿主语言/主题可驱动内嵌网页（如 dsh 写 `~/.dsh/settings.yaml`） |
| 本地优先 | 设置/插件/日志均在 `~/.dlient-open`，无账号、无遥测服务器 |

**示意图（截图将放入 `docs/`）**：

```
 .dlient ──► 导入确认（权限 / 依赖 双 tab）
                │ 确认
                ▼
        解包 → 改写 manifest（source=local, system=false）
                │
                ├─► preInstall 依赖：npm / GitHub Release / URL（递归、去重）
                │
                └─► 写入本地 signature.json（package.json + dist/**）
                ▼
    运行：worker（Node 池） · UI（宿主内 React） · host-api 全部经权限校验
```

---

# 架构

```
dlient-open/
├─ app/                 Electron 宿主（main / preload / renderer）
│  ├─ packages/         @dlient-open 各 npm 包（源码直连）
│  │   ├─ core/         池 / controller / 协议（仅宿主内部，绝不发布到 npm）
│  │   ├─ plugin-sdk/   createWorkerRpc、host-api 类型、vite 辅助
│  │   ├─ api-types/    host-api 签名单源（HostApiMap）
│  │   ├─ api-bridge/   UI ⇄ worker 桥
│  │   ├─ ui/           React 共享组件（Webview、PluginView …）
│  │   ├─ i18n/         locale provider + 文案包
│  │   └─ native-host-sdk/   原生模块 JSON-RPC 客户端/服务端
│  └─ src/main/         api 表、org（签名/验签）、host-shell、runtime …
├─ packages/
│  └─ create-plugin/    脚手架：npx @dlient-open/create-plugin
├─ plugins/
│  └─ dsh/              示例插件（内嵌 DeepSeek Harness Web）
├─ scripts/             make-dlient.mjs（免签名 .dlient 打包）
└─ skills/              插件开发技能（英文 + 简体中文）
```

- **主进程**：窗口、`dlientV3://` 协议、插件注册表、host-api 执行器、权限校验、本地签名/验签。
- **worker**：插件各自的 Node 进程（solo/shared 池）。不直接碰系统能力，一切特权操作经 host-api。
- **UI**：React 渲染于宿主；插件包由 SystemJS 加载，共享 `@dlient-open/ui` / `@dlient-open/i18n`。
- **内置页**：操作台 Console、设置 Settings——`layout / setting / nodejs` 都在宿主内，不是插件。

---

# 快速开始

### 1. 从源码跑起宿主

```bash
git clone <本仓库> dlient-open
cd dlient-open/app
npm install
npm run dev        # 启动带宿主 UI 的 Electron
```

> [!NOTE]
> 数据默认在 `~/.dlient-open`（Windows：`%USERPROFILE%\.dlient-open`）。

### 2. 60 秒内安装一个插件

1. 点击操作台右上「导入插件」；
2. 选择 `.dlient` 包（示例：先构建 `plugins/dsh`，见下）；
3. 在「权限 / 依赖」两个 tab 里确认后即导入并打开。

### 3. 尝试内置示例插件

```bash
cd dlient-open/plugins/dsh
npm install
npm run pack      # 产出 dsh-0.1.0.dlient
```

再到宿主导入该文件。dsh 需要 Node.js ≥ 22，宿主会自动解析运行时（内置 LTS 或本机 node）。

**详细文档**
- manifest / host-api / 权限模型：`skills/`（`dlient-plugin-dev` 英文、`dlient-plugin-dev-cn` 中文）
- 脚手架：`npx @dlient-open/create-plugin my-plugin`（见 `packages/create-plugin/README.md`）

---

# 插件开发

插件 = 带 `dlient` manifest 的 `package.json` + 可选 worker（`src/main`）与/或 UI（`src/renderer`）。

```jsonc
{
  "name": "my-plugin",
  "dlient": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "0.1.0",
    "type": "app",                 // app | full | worker | ui
    "icon": "assets/icon.svg",
    "permissions": ["child.spawn", "net.getFreePort", "log.write"],
    "nodeVersion": "22",
    "preInstall": {                // 深度安装依赖（可选）
      "helper-a": "0.5.1",
      "helper-b": "https://github.com/owner/helper-b",
      "helper-c": "https://example.com/helper-c.dlient"
    }
  }
}
```

- **worker**：`import { createWorkerRpc } from '@dlient-open/plugin-sdk'`，通过 `rpc.fs.* / rpc.child.* / rpc.nodejs.* / rpc.plugin.*` 调宿主。
- **UI**：React + `@dlient-open/ui`；内嵌外部页面用 `Webview` 组件。
- **打包**：`npm run pack`（本插件的 `script/make-dlient.mjs`）→ 免签名 `.dlient`；导入时宿主会本地签名。

> [!WARNING]
> 开源版没有“验签商店”。导入插件即代表信任你选的 `.dlient`：它会在导入弹框批准的那些权限下运行。

---

# 路线图

- [x] 本地导入 + 权限/依赖确认
- [x] 内置 `nodejs.*` 运行时 host-api（无需插件）
- [x] `preInstall` 深度安装（npm / GitHub Release / 直链）
- [x] `plugin.install`（用户确认后安装）
- [x] 本地完整性签名 + 启动/协议加载校验
- [x] 宿主语言/主题 → 内嵌网页同步（dsh settings.yaml）
- [x] 开源版插件开发技能（中英）
- [ ] Windows / macOS / Linux 预构建安装包
- [ ] 更多插件模板与示例
- [ ] 宿主与插件的自动化测试与 CI
- [ ] `docs/` 可视化文档与截图

---

# 如何参与

- 报 Bug / 提需求：提 issue，附上复现步骤（宿主日志在 `~/.dlient-open/plugin-data/<pluginId>/logs/`）。
- 贡献代码：fork 后，宿主在 `app/`、插件在 `plugins/` 开发；改完务必先 `npm run build`（源码与 dist 保持一致），遵守安全不变量（worker 不得绕过 host-api 权限校验；`@dlient/core` 只做本地源码引用、绝不发布到 npm），然后提交 PR 并说明改了什么、为什么。

完整指南见 `CONTRIBUTING.md`（规划中）。

---

# 许可证

本仓库许可证尚未确定：首个公开版本发布前会补充 `LICENSE` 文件，在此之前保留一切权利。
