<div align="center">

# dlient

**本地优先、插件驱动的桌面 AI Agent 宿主。**

```
Electron 宿主 · Node 插件 Worker · React 插件 UI · 本地导入 · 无需服务器
```

> **简体中文** · [English](README.md)

</div>

---

## 目录

- [这是什么](#这是什么)
- [功能特性](#功能特性)
- [架构](#架构)
- [快速开始](#快速开始)
- [插件开发](#插件开发)
- [路线图](#路线图)
- [如何参与](#如何参与)
- [许可证](#许可证)

---

## 这是什么

`dlient` 是一个桌面 AI Agent 插件宿主。宿主本身只做三件事：**装插件、跑插件、把它们连起来**。插件是一个 `.dlient` 包，可包含两部分：

- **worker**：运行在宿主 worker 池中的 Node 进程（无 DOM、无渲染层）；
- **UI**：React 打包为 `SystemJS remoteEntry.js`，由宿主渲染层加载。

一切能力来自插件，由你决定装什么、跑在哪里。无需账号、无遥测服务器、无应用商店——插件以 `.dlient` 包分发，本地导入即可。

- **插件优先**：能力完全来自插件。
- **完全本地**：数据落在 `~/.dlient-open`。
- **深度安装**：插件可声明 `preInstall` 依赖，由宿主自动从 npm、GitHub Release 或直链 URL 解析。
- **本地完整性**：每个安装的包都会被本地签名并在启动/加载 UI 时校验，损坏的包会被拒绝而不是带病运行。

---

## 功能特性

| 领域 | 说明 |
| --- | --- |
| 插件运行时 | Node worker 池 + React UI，页面 keep-alive 不销毁 |
| 权限模型 | manifest.permissions 方法级权限 + 资源路径/白名单校验 |
| 内置运行时 | `nodejs.*` host-api（探测 / 解析 / 安装内置 Node.js LTS），无需插件 |
| 深度安装 | `preInstall`：npm semver · GitHub 最新 Release 的 .dlient 资产 · URL 直链 |
| 完整性 | 安装时本地写入 Ed25519 `signature.json`，启动与协议加载时校验 |
| 本地优先 | 设置 / 插件 / 日志都在 `~/.dlient-open` |

数据流示意：

```
 .dlient ──► 导入 ──► 解包 → 改写 manifest（source=local, system=false）
                │
                ├─► preInstall 依赖：npm / GitHub Release / URL（递归、去重）
                │
                └─► 写入本地 signature.json（package.json + dist/**）
                ▼
    运行：worker（Node 池） · UI（宿主内 React） · host-api 调用全部经过权限校验
```

---

## 架构

```
dlient-open/
├─ app/                 Electron 宿主（main / preload / renderer）
│  ├─ packages/         @dlient-open 各 npm 包（源码直连）
│  │   ├─ core/         池 / controller / 协议
│  │   ├─ create-plugin/   脚手架包（模板在 templates/plugin-demo）
│  │   ├─ plugin-sdk/   createWorkerRpc、host-api 类型、vite 辅助
│  │   ├─ api-types/    host-api 签名单源（HostApiMap）
│  │   ├─ api-bridge/   UI ⇄ worker 桥
│  │   ├─ ui/           React 共享组件（Webview、PluginView …）
│  │   ├─ i18n/         locale provider + 文案包
│  │   └─ native-host-sdk/   原生模块 JSON-RPC 客户端/服务端
│  └─ src/main/         api 表、org（签名/验签）、host-shell、runtime …
├─ plugins/
│  └─ dsh/              示例插件（内嵌 DeepSeek Harness Web）
└─ skills/              插件开发技能（简体中文 + English）
```

- **主进程**：窗口、`dlientV3://` 协议、插件注册表、host-api 执行器、权限校验、本地签名/验签。
- **worker**：每个插件一个 Node 进程（solo / shared 池）。特权操作不直接碰系统能力，一律经 host-api 由主进程校验。
- **UI**：React 渲染于宿主；插件包由 SystemJS 加载，共享 `@dlient-open/ui` / `@dlient-open/i18n`。
- **内置页**：操作台 Console 与设置 Settings 属于宿主本体（`layout` / `setting` / `nodejs`），不是插件。

---

## 快速开始

### 1. 从源码起跑宿主

```bash
git clone <本仓库> dlient-open
cd dlient-open/app
npm install
npm run dev
```

> [!NOTE]
> 数据默认在 `~/.dlient-open`（Windows：`%USERPROFILE%\.dlient-open`）。

### 2. 安装插件（60 秒内）

1. 点击操作台右上「导入插件」；
2. 选择 `.dlient` 包并确认导入；
3. 插件本地安装完成并打开。

### 3. 尝试示例插件

```bash
cd dlient-open/plugins/dsh
npm install
npm run pack        # 产出 dsh-0.1.0.dlient
```

再到宿主导入该文件。dsh 需要 Node.js ≥ 22，宿主会自动解析运行时（内置 LTS 或本机 node）。

### 详细文档

- manifest / host-api / 权限模型：`skills/`（`dlient-plugin-dev-cn` 简体中文、`dlient-plugin-dev` English）
- 脚手架：`npx @dlient-open/create-plugin my-plugin`（见 `app/packages/create-plugin/README.md`）

---

## 插件开发

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

- **worker**：`import { createWorkerRpc } from '@dlient-open/plugin-sdk'`，经 `rpc.fs.* / rpc.child.* / rpc.nodejs.* / rpc.plugin.*` 调宿主。
- **UI**：React + `@dlient-open/ui`；内嵌外部页面用 `Webview` 组件。
- **打包**：`npm run pack`（插件内的 `script/make-dlient.mjs`）→ `.dlient`；导入时宿主会本地签名。

---

## 路线图

- [x] 本地插件导入 / 卸载与注册表
- [x] 内置 `nodejs.*` 运行时 host-api
- [x] `preInstall` 深度安装（npm / GitHub Release / 直链）
- [x] 本地完整性签名，启动与协议加载时校验
- [x] 插件开发技能（简体中文 + English）
- [ ] Windows / macOS / Linux 预构建安装包
- [ ] 更多插件模板与示例
- [ ] 宿主与插件的自动化测试与 CI
- [ ] `docs/` 可视化文档与截图

---

## 如何参与

报 Bug / 提需求：提 issue 并附复现步骤；宿主日志在 `~/.dlient-open/plugin-data/<pluginId>/logs/`。

欢迎贡献代码：

1. Fork 仓库；宿主在 `app/` 开发、插件在 `plugins/` 开发；
2. 改动完成后先 `npm run build`（源码与 dist 保持一致）；
3. 提交 PR 并说明改了什么、为什么。

完整指南见 `CONTRIBUTING.md`（规划中）。

---

## 许可证

[MIT](LICENSE) © 2026 dlient contributors
