# @dlient-open/create-plugin

**dlient** 插件脚手架。一条命令创建插件工程，构建成 `.dlient` 包后即可导入开源版 dlient 宿主。

> **简体中文** · [English](README.md)

## 快速开始

```bash
npx @dlient-open/create-plugin my-plugin          # 默认 default 模式：纯 UI（无 worker）

cd my-plugin
npm install          # 脚手架不会自动安装依赖、也不会初始化 git
npm run dev          # 开发时 watch 构建
npm run build        # 构建 UI（remoteEntry）
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
| `--worker` | **worker** 模式：UI + worker（后台 RPC / 子进程） |
| `--native-host` | **native-host** 模式：UI + worker + 原生模块由官方 Node 子进程承载（`dlient.nativeModules` + `@dlient-open/native-host-sdk`），免 rebuild |
| `--native` | **native** 模式：UI + worker + vendor 预编译 + `@electron/rebuild`（逐平台构建） |

不给模式参数即 **default** 模式：纯 UI 插件 —— 无 worker、无 `skills/`、无 `build:worker`。模式参数互斥（一个工程只对应一份模板）。

`--skip-install` 与 `--no-git` 为兼容参数，不产生任何动作 —— 本 CLI 从不安装依赖、也不初始化仓库。

## 生成内容

四种模式共用同一份基础骨架，模式参数只在其上追加文件：

```
my-plugin/
├─ .agent/                AI 编码助手的开发文档（英文；四种模式共用）
├─ assets/                icon.svg · index.md / index.en-US.md / index.zh-CN.md（面向使用者的文档）· mcp.json
├─ src/renderer/App.tsx   UI（React + Vite）→ dist/remoteEntry.js
├─ script/                build-clean.mjs · make-dlient.mjs
└─ package.json           dlient manifest（`dlient` 对象）+ scripts
```

| 模式 | 在基础骨架之上追加 |
|------|------------------|
| `default` | — |
| `worker` | `src/main/index.ts`（worker）、`script/build-worker.mjs`、`skills/SKILL.md` |
| `native-host` | worker 文件 + `src/native-host/index.ts`、`dlient.nativeModules`、`@dlient-open/native-host-sdk` |
| `native` | worker 文件 + `script/build-native.mjs`、`dlient.native: true`、`@electron/rebuild`、`npm run build:native` |

说明：

- `assets/index.md` / `index.en-US.md` 由工程根 `README.md` 生成，`assets/index.zh-CN.md` 由 `README.cn.md` 生成 —— 它们是插件详情页里给用户看的文档。
- `.agent/` 存放插件开发文档（host-api、manifest 规范、UI 组件库、worker 模型、三份模式变换指南，以及 `example/` 下可直接拷贝的示例源码）。它由 `dlient-plugin-dev` 技能生成，四种模板共用同一份。让 AI 助手读这里即可，入口见 `AGENTS.md`（其中标注了当前工程所处的模式）。
- 生成的 `package.json` 已声明 `files: ["dist", "assets", "script", "*.dlient"]` 与 `prepublishOnly: "npm run pack"`，因此发布时总会带上最新的 `.dlient`。
- 只有构建出 worker（`dist/worker.js`）的插件才带 `skills/SKILL.md`，也只有这类插件才能把方法 expose 给其他插件（与 manifest `type` 无关）。保持纯 UI 成本最低 —— 确实需要后台逻辑时再按 `.agent/references/mode-switch-*.md` 切换模式。

## 发布

- **本地分发** —— `npm run pack` 在工程旁产出 `<id>-<version>.dlient`。开源版宿主不做签名校验，可直接导入。
- **发布到 npm** —— 先提升 `version`，再 `npm publish`。有两条约定：
  - `keywords` **必须包含 `dlient-open-plugin`** —— 该 keyword 专用于插件包（插件市场按它检索），非插件包不得使用；
  - 保持 `.dlient` 在发布包内（`files` 字段已处理）—— 宿主是从 npm 包内的 `.dlient` 安装的。

## 环境要求

Node.js ≥ 18（自带 npm）。无需全局安装任何东西。

## 开发本包

模板位于 `templates/{default,worker,native-host,native}/`（四份各自预裁剪的模板），外加 `templates/_shared/.agent/` —— 四份模板共用的唯一一份文档（由 `skills/dlient-plugin-dev` 生成，不会漂移）。

```bash
npm run prepare:templates   # 从 skills/ 同步 _shared/.agent + 校验 4 份模板
npm run pack                # npm pack（产出 tarball 供本地检查）
```

验证改动可在本目录直接跑 CLI 并检查生成结果：

```bash
node bin/cli.mjs demo-plugin --dir <临时目录>                  # default（纯 UI）
node bin/cli.mjs demo-plugin --worker --dir <临时目录>         # worker
node bin/cli.mjs demo-plugin --native-host --dir <临时目录>    # native-host
node bin/cli.mjs demo-plugin --native --dir <临时目录>         # native（vendor 预编译）
```
