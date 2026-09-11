# 模式切换：仅 UI（`default`）→ native（UI + worker + 随包内置原生模块）

本指南把**仅 UI** 插件（脚手架不带任何 flag）转换为 **native** 模式：UI + worker + **随包内置到
`dist/`** 的原生 `.node` 模块，并用 `@electron/rebuild`（`npm run build:native`）按宿主 Electron ABI
重建。它对应 `templates/native` 模板，由 `npx @dlient-open/create-plugin <id> --native` 生成。

它复用 worker 文件，因此等于 `worker` 模式再加一个随包内置原生的构建步骤。

## 1. 何时选此模式

当插件需要无法在沙箱 worker 内加载的 `.node` addon（如 `better-sqlite3`、`ssh2`、`node-pty`、
图像/音频编解码器），**且**你希望预构建随 `.dlient` 一起分发（自包含、用户机器上无需安装期 npm
步骤）时，选 `native`。

新项目优先用 **native-host** 模式（`dlient.nativeModules`）：它在用户侧安装原生包并在官方 Node
子进程中加载，因此**无需逐平台 rebuild**。

| | `native`（本指南） | `native-host`（`dlient.nativeModules`） |
| --- | --- | --- |
| ABI | Electron ABI，逐平台用 `@electron/rebuild` rebuild | **官方 Node ABI**（免 rebuild） |
| `.node` 随包 | `dist` 内置（须声明 `platforms`） | 不随包；用户侧 npm 安装 |
| 构建步骤 | 每个目标平台执行 `npm run build:native` | 无额外步骤 |

**不要**在没有原生模块、或存在纯 JS 替代方案时用此模式——随包预构建必须**在每个目标平台分别构建**，
且会抬高安装期信任级别。不需要原生代码就保持**仅 UI**（`default`）；只需要不含 `.node` addon 的
Node 代码就用普通 **`worker`** 模式。

> 两条 native 路径互斥：只能声明 **`dlient.native`** 或 **`dlient.nativeModules`** 之一，不可同时。
> 见 `references/native-host.md`。

## 2. 需要新增的文件

从 `.agent/example/worker/` 复制 worker 文件，并从对应的 `native` 模板取 `script/build-native.mjs`
（`.agent/` 不含 `native` 示例；该文件与 `npx @dlient-open/create-plugin <id> --native` 生成的相同）。

| 从 | 复制到（工程） | 说明 |
| --- | --- | --- |
| `.agent/example/worker/src/main/index.ts` | `src/main/index.ts` | worker 入口——`createWorkerRpc('<plugin-id>')`，一个示例 handler（+ 可选的 `grant` handler） |
| `templates/native/script/build-native.mjs` | `script/build-native.mjs` | 把 `.node` 预构建内置进 `dist/`，并经 `@electron/rebuild` 针对当前平台重建 |
| `.agent/example/worker/build-worker.mjs` | `script/build-worker.mjs` | esbuild 构建 → `dist/worker.js`（若存在 `src/native-host/` 也会产出 `dist/native-host.js`） |

示例用占位符 `__PLUGIN_ID__`——替换为你的插件 id（脚手架生成工程时已自动替换）。

最终布局（native 专属文件以 `+` 标注）：

```
my-plugin/
├── package.json
├── script/
│   ├── build-clean.mjs
│   ├── build-native.mjs        # + added (vendors + rebuilds the .node prebuilds)
│   ├── build-worker.mjs        # + added
│   └── make-dlient.mjs
├── skills/
│   └── SKILL.md                # + added (see §5)
├── src/
│   ├── main/
│   │   └── index.ts            # + added
│   └── renderer/               # UI (unchanged)
└── .agent/
```

## 3. `package.json` 改动

### 3.1 `scripts`

新增 `build:worker`、`build:native` 与 `dev:watch:worker`，把 `build:worker` **与** `build:native`
追加进 `build` 链，并为合并的 `dev` watch 加上 `concurrently`：

```jsonc
"scripts": {
  "build": "node script/build-clean.mjs && npm run typecheck && npm run build:ui && npm run build:worker && npm run build:native",
  "typecheck": "tsc --noEmit",
  "build:ui": "vite build",
  "build:worker": "node script/build-worker.mjs",
  "build:native": "node script/build-native.mjs",
  "pack": "npm run build && node script/make-dlient.mjs",
  "prepublishOnly": "npm run pack",
  "dev:watch": "vite build --watch",
  "dev:watch:worker": "node script/build-worker.mjs --watch",
  "dev": "concurrently -k \"npm:dev:watch\" \"npm:dev:watch:worker\""
}
```

| 改动 | 原因 |
| --- | --- |
| `build:native` → `node script/build-native.mjs` | 把 `.node` 预构建内置进 `dist/` 并针对当前平台重建 |
| `build` 追加 `&& npm run build:native` | 一次 `npm run build` 仍能构建全部 |

### 3.2 `dlient` manifest 字段

```jsonc
"dlient": {
  "native": true,
  "platforms": [
    "win32.x64", "win32.arm64",
    "darwin.x64", "darwin.arm64",
    "linux.x64", "linux.arm64"
  ]
}
```

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `native` | `true` | `.node` 预构建内置进 `dist/`；与 `nativeModules` **互斥**——绝不同时声明 |
| `platforms` | 六个 OS.arch 组合的子集 | 与 `native` 搭配时**必填**——随包预构建绑定平台，只列你实际构建的组合 |

### 3.3 devDependencies

```jsonc
"devDependencies": {
  "@electron/rebuild": "^3.6.0",
  "esbuild": "^0.20.0",
  "concurrently": "^9.1.0"
}
```

- `@electron/rebuild` —— 把随包内置的原生模块按宿主 Electron ABI（逐平台）重建。
- `esbuild` —— `script/build-worker.mjs` 所需（`concurrently` 仅用于合并的 `dev`）。

改完执行 `npm install`。

## 4. 权限与 expose 策略

在 `dlient.permissions` 中加入：

```jsonc
"permissions": ["log"]
```

`log` 让 worker 无需 fs 权限就能写自己的日志（`rpc.log.write` → `plugin-data/<id>/logs/main.log`）。
再把 worker 实际调用的其它 host-api key（`fs.read`、`child.spawn`、`app.data` 等）加进来；资源访问
还需 `fsDirs` / `spawnCmds` 或运行时授权。

> **expose 策略——尽量少暴露。** **仅当**其它插件确实必须调用本插件（或用户明确要求）时才添加
> `dlient.expose` 条目。插件能暴露方法的**唯一条件**是它真的带 worker —— 即构建产物包含 `dist/worker.js`；
> manifest 的 `type` 与能否暴露无关，而本模式带 worker，因此可以自由暴露。真要暴露时：
>
> - **尽量**同时暴露 `grant` handler（推荐而非强制）
>   （`"expose": { "grant": { "description": "…", "access": "default" } }`），
>   并优先返回 `{ status: 'ask' }`，让用户在调用时决定；
> - 对涉及用户隐私、密码、密钥或 token 的一律返回 `{ status: 'deny' }`。
>
> 见 `references/worker.md` §4.2–4.3。

## 5. `skills/SKILL.md`

**只有在 worker 存在后**才附带 agent 技能——仅 UI 插件不得包含 `skills/`。最小骨架：

````md
---
name: "__PLUGIN_ID__"
description: "One line: what this plugin does and when an agent should invoke it."
---

# __PLUGIN_ID__

One paragraph: what the plugin does and the host capabilities it uses.

## Methods

| Method | Args | Returns | Description |
| --- | --- | --- | --- |
| `__PLUGIN_ID__.greet` | `name?` | `string` | Return a greeting message |

## Example

```ts
const msg = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.greet', ['world'])
```
````

`skills/SKILL.md` 保持在 `skills/` 下；打包进 `.dlient` 时原样带入。

## 6. 验证与回退

**构建**

```bash
npm install
npm run build         # → dist/remoteEntry.js (UI) + dist/worker.js (worker) + vendored/rebuilt natives in dist/
```

确认 `dist/worker.js` 存在，**且**随包内置的 `.node` 预构建已在 `dist/` 中就位（并已重建）。宿主只在
`dist/worker.js` 存在时才 fork worker。由于预构建绑定平台，打包前必须在**每个**目标平台执行
`npm run build:native`。

**确认宿主加载**

1. dev 流程：把工程放进 `dlient-open/plugins/<插件id>` 并执行 `npm run dev`（产物级 watch）。
   重开 / 重载宿主以拾取变更。
2. 导入流程：`npm run pack`，宿主操作台 →「导入插件」→ 选择 `.dlient`。随包预构建一起进入包内——
   用户侧无需 npm 步骤。
3. 查看 `USER_DATA/plugin-data/<插件id>/logs/main.log`（`USER_DATA` = `~/.dlient-open`）——应能看到
   worker 的 `log` 行。

**回退**

- 回到 **`worker`**（仅去掉原生构建）：删除 `script/build-native.mjs`，从 `build` 链移除 `build:native`
  脚本与 `&& npm run build:native` 步骤，移除 `dlient.native`（若 `platforms` 只因 native 而存在也一并
  移除），去掉 `@electron/rebuild` 与随包预构建；保留 `src/main/`、`dist/worker.js`、`skills/` 与
  `dlient.expose`。
- 回到 **`default`**（纯 UI）：在上述基础上**再**应用 `references/mode-switch-worker.md` §6 的回退
  说明（删除 `src/main/`、`build:worker` / `dev:watch:worker` 脚本、`dlient.expose` 与 `skills/`；
  确认 UI 不再调用 worker）。

## 7. 参考

- `.agent/example/worker/` —— 上述可直接复制的 worker 源码。
- `references/worker.md` —— worker SDK/RPC、日志、子进程句柄、expose + grant。
- `references/native-host.md` —— 推荐的 native 路径（`nativeModules`，无需逐平台 rebuild）。
- `references/manifest-schema.md` —— 每个 `dlient.*` 字段（`native`、`nativeModules`、`platforms`、`permissions`、`expose` …）。
- `references/create-plugin.md` —— 脚手架 flag、模板模式、开发流程、打包与导入。
- `references/mode-switch-worker.md` —— 普通 worker 模式（不含原生模块）。
- `references/mode-switch-native-host.md` —— 随包预构建的替代方案 native-host。
