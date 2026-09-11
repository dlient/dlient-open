# @dlient-open/create-plugin

**dlient** 插件脚手架。一条命令创建插件工程，构建成 `.dlient` 包后即可导入开源版 dlient 宿主。

> **简体中文** · [English](README.md)

## 快速开始

```bash
npx @dlient-open/create-plugin my-plugin

cd my-plugin
npm install          # 脚手架不会自动安装依赖、也不会初始化 git
npm run dev          # 开发时 watch 构建
npm run build        # 构建 UI（remoteEntry）+ worker
npm run pack         # → my-plugin-0.1.0.dlient
```

然后打开 **dlient** → **导入插件** → 选择生成的 `.dlient`。

## 用法

```
npx @dlient-open/create-plugin <插件id> [选项]
```

`<插件id>` 须以小写字母开头，仅含小写字母 / 数字 / 连字符（如 `my-plugin`）。

| 选项 | 说明 |
|------|------|
| `--name "<显示名>"` | 插件显示名（默认与 id 相同） |
| `--dir <路径>` | 创建目录（默认为当前目录） |
| `--native-host` | 原生模块由官方 Node 子进程承载（`dlient.nativeModules` + `@dlient-open/native-host-sdk`），免 rebuild |
| `--native` | 原生模块走 vendor 预编译 + `@electron/rebuild`（逐平台构建） |

`--skip-install` 与 `--no-git` 为兼容参数，不产生任何动作 —— 本 CLI 从不安装依赖、也不初始化仓库。

## 生成内容

```
my-plugin/
├─ .agent/                AI 编码助手的开发文档（英文）
├─ assets/                icon.svg · index.md / index.en-US.md / index.zh-CN.md（面向使用者的文档）· mcp.json
├─ skills/SKILL.md        本插件提供的 Agent 技能
├─ src/
│  ├─ main/index.ts       worker（Node）：RPC 处理函数
│  └─ renderer/App.tsx    UI（React + Vite）
├─ script/                build-clean.mjs · build-worker.mjs · make-dlient.mjs
└─ package.json           dlient manifest（`dlient` 对象）+ scripts
```

说明：

- `assets/index.md` / `index.en-US.md` 由工程根 `README.md` 生成，`assets/index.zh-CN.md` 由 `README.cn.md` 生成 —— 它们是插件详情页里给用户看的文档。
- `.agent/` 存放插件开发文档（host-api、manifest 规范、UI 组件库、worker 模型）。让 AI 助手读这里即可，入口见 `AGENTS.md`。
- 生成的 `package.json` 已声明 `files: ["dist", "assets", "script", "*.dlient"]` 与 `prepublishOnly: "npm run pack"`，因此发布时总会带上最新的 `.dlient`。

## 发布

- **本地分发** —— `npm run pack` 在工程旁产出 `<id>-<version>.dlient`。开源版宿主不做签名校验，可直接导入。
- **发布到 npm** —— 先提升 `version`，再 `npm publish`。有两条约定：
  - `keywords` **必须包含 `dlient-open-plugin`** —— 该 keyword 专用于插件包（插件市场按它检索），非插件包不得使用；
  - 保持 `.dlient` 在发布包内（`files` 字段已处理）—— 宿主是从 npm 包内的 `.dlient` 安装的。

## 环境要求

Node.js ≥ 18（自带 npm）。无需全局安装任何东西。

## 开发本包

模板源在 `templates/plugin-demo/`。验证改动可在本目录直接跑 CLI（`node bin/cli.mjs demo-plugin --dir <临时目录>`）并检查生成结果。

```bash
npm run prepare:templates   # 检查模板已就位
npm run pack                # npm pack（产出 tarball 供本地检查）
```
