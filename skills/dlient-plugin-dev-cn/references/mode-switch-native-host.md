# 模式切换：仅 UI（`default`）→ native-host（UI + worker + 原生模块）

本指南把**仅 UI** 插件（脚手架不带任何 flag）转换为 **native-host** 模式：UI + worker + 由专用
**全权限官方 Node 子进程**加载的原生 `.node` 模块。由于该子进程运行官方 Node 运行时，原生模块按
官方 Node ABI 构建——**无需 `@electron/rebuild`**。

可直接复制的源码见 `.agent/example/native-host/`。

## 1. 何时选此模式

当插件需要无法在沙箱 worker 内加载的 `.node` addon（如 `better-sqlite3`、`ssh2`、`node-pty`、
图像/音频编解码器）时，选 `native-host`。

优先 `native-host`（`dlient.nativeModules`）而非内置 **`native`** 路径（`dlient.native`）：

| | `native`（内置 + `@electron/rebuild`） | `native-host`（本指南） |
| --- | --- | --- |
| ABI | Electron ABI，逐平台 rebuild | **官方 Node ABI**（免 rebuild） |
| `.node` 随包 | `dist` 内置（须声明 `platforms`） | 不随包；用户侧 npm 安装 |
| 构建步骤 | 每个目标平台执行 `npm run build:native` | 无额外步骤 |

**不要**在没有原生模块、或存在纯 JS 替代方案时用此模式——native-host 子进程是全权限 Node，会抬高
安装期信任级别。仅 UI 或普通 `worker` 插件更简单、更安全。

> 两条 native 路径互斥：只能声明 **`dlient.native`** 或 **`dlient.nativeModules`** 之一，不可同时。
> 见 `references/native-host.md`。

## 2. 需要新增的文件

从 `.agent/example/native-host/` 复制：

| 从 `.agent/example/native-host/` 复制 | 到（工程） | 说明 |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | worker 入口——拉起 / 转发到 native-host，注册 `grant` handler |
| `src/native-host/index.ts` | `src/native-host/index.ts` | native-host 入口——纯 Node，加载原生模块，注册 service |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild 构建 → `dist/worker.js` **与** `dist/native-host.js`（因存在 `src/native-host/` 而自动产出） |

示例用占位符 `__PLUGIN_ID__`——替换为你的插件 id（脚手架生成工程时已自动替换）。

最终布局（native-host 专属文件以 `+` 标注）：

```
my-plugin/
├── package.json
├── script/
│   ├── build-clean.mjs
│   ├── build-worker.mjs        # + 新增
│   └── make-dlient.mjs
├── skills/
│   └── SKILL.md                # + 新增（见 §5）
├── src/
│   ├── main/
│   │   └── index.ts            # + 新增
│   ├── native-host/
│   │   └── index.ts            # + 新增
│   └── renderer/               # UI（不变）
└── .agent/
```

## 3. `package.json` 改动

### 3.1 `scripts`

新增 `build:worker` 与 `dev:watch:worker`，并把 `build:worker` 追加进 `build` 链。native-host
**无需额外脚本**：`build-worker.mjs` 会自动产出 `dist/native-host.js`。

```jsonc
"scripts": {
  "build": "node script/build-clean.mjs && npm run typecheck && npm run build:ui && npm run build:worker",
  "typecheck": "tsc --noEmit",
  "build:ui": "vite build",
  "build:worker": "node script/build-worker.mjs",
  "pack": "npm run build && node script/make-dlient.mjs",
  "prepublishOnly": "npm run pack",
  "dev:watch": "vite build --watch",
  "dev:watch:worker": "node script/build-worker.mjs --watch",
  "dev": "concurrently -k \"npm:dev:watch\" \"npm:dev:watch:worker\""
}
```

### 3.2 `dlient` manifest 字段

```jsonc
"dlient": {
  "native": false,
  "nativeModules": {
    "useBundledNode": true,
    "dependencies": {}
  }
}
```

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `nativeModules.useBundledNode` | `true` | native-host 跑在宿主内置的官方 Node 上 |
| `nativeModules.dependencies` | `{}` → 填写 | npm 包 → 版本，如 `{ "better-sqlite3": "^11.0.0" }`；导入时用户侧安装 |
| `native` | `false` | 与 `nativeModules` 互斥——保持 `false` |

### 3.3 devDependencies

```jsonc
"devDependencies": {
  "@dlient-open/native-host-sdk": "^0.1.1",
  "esbuild": "^0.20.0",
  "concurrently": "^9.1.0",
  "better-sqlite3": "^11.0.0"
}
```

- `@dlient-open/native-host-sdk` —— worker 侧 client + native-host 侧 server。
- `esbuild` —— `script/build-worker.mjs` 所需（`concurrently` 仅用于合并的 `dev`）。
- 同时把 `nativeModules.dependencies` 里的每个原生包也加到 `devDependencies`，便于本地构建 /
  类型。改完执行 `npm install`。

## 4. 权限与 expose 策略

在 `dlient.permissions` 中加入：

```jsonc
"permissions": ["log", "nodejs.resolveRuntime", "child.spawn"]
```

| 权限 | 使用方 |
| --- | --- |
| `log` | `rpc.log.write`（worker + native-host 日志） |
| `nodejs.resolveRuntime` | 示例 worker 解析官方 Node 二进制路径 |
| `child.spawn` | 示例 worker 拉起 native-host 子进程（`rpc.child.spawn`） |

`app.getPath` 没有组前缀，必须在 `dlient.permissions` 中以精确 key `app.getPath` 声明（无需资源授权，但声明是必须的）。对解析出的 Node 二进制的 `child.spawn` 仍受命令白名单 / 运行时授权约束
（如有需要请声明 `spawnCmds`）。见 `references/permission-model.md`。

> **expose 策略——尽量少暴露。** **仅当**其它插件确实必须调用本插件（或用户明确要求）时才添加
> `dlient.expose` 条目。插件能暴露方法的**唯一条件**是它真的带 worker —— 即构建产物包含 `dist/worker.js`；
> manifest 的 `type` 与能否暴露无关，而本模式带 worker，因此可以自由暴露。真要暴露时：
>
> - **尽量**同时暴露 `grant` handler（推荐而非强制）
>   （`"expose": { "grant": { "description": "…", "access": "default" } }`），
>   并优先返回 `{ status: 'ask' }`；
> - 对涉及用户隐私、密码、密钥或 token 的一律返回 `{ status: 'deny' }`。
>
> 见 `references/worker.md` §4.2–4.3。把 native-host 访问视为安装级信任：
> 保持 service 暴露面狭窄，并重新校验每个参数（见 `references/native-host.md` §8）。

## 5. `skills/SKILL.md`

**只有在 worker 存在后**才附带 agent 技能——仅 UI 插件不得包含 `skills/`。最小骨架：

````md
---
name: "__PLUGIN_ID__"
description: "One line: what this plugin does and when an agent should invoke it."
---

# __PLUGIN_ID__

One paragraph: what the plugin does, which native modules it uses and why.

## Methods

| Method | Args | Returns | Description |
| --- | --- | --- | --- |
| `__PLUGIN_ID__.echo` | `value` | `unknown` | Forward to the native-host `example.echo` service |

## Example

```ts
const out = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.echo', ['hello'])
```
````

`skills/SKILL.md` 保持在 `skills/` 下；打包进 `.dlient` 时原样带入。

## 6. 验证与回退

**构建**

```bash
npm install
npm run build         # → dist/remoteEntry.js + dist/worker.js + dist/native-host.js
```

确认 **`dist/worker.js` 与 `dist/native-host.js` 都存在**。只有当 `src/native-host/index.ts` 存在时
构建才会产出 `native-host.js`。

**确认宿主加载**

1. dev 流程：把工程放进 `dlient-open/plugins/<插件id>` 并执行 `npm run dev`；重开 / 重载宿主以
   拾取变更。
2. 导入流程：`npm run pack`，宿主操作台 →「导入插件」→ 选择 `.dlient`。宿主会在用户侧安装
   `nativeModules.dependencies`（导入时需要 `npm install`）。
3. 调用一个暴露的方法（如 `__PLUGIN_ID__.echo`），并查看
   `USER_DATA/plugin-data/<插件id>/logs/main.log`（`USER_DATA` = `~/.dlient-open`）里的
   worker + native-host 日志行。

**回退（回到仅 UI）**

- 删除 `src/main/`、`src/native-host/`、`dist/worker.js` 与 `dist/native-host.js`；
- 移除 `build:worker` / `dev:watch:worker` 脚本与 `&& npm run build:worker` 步骤；
- 移除 `dlient.nativeModules`（以及 `native: false`）、`@dlient-open/native-host-sdk`、`dlient.expose`
  与 `skills/`；
- 从 `devDependencies` 去掉 `nativeModules.dependencies` 里的包；
- 确认 UI 不再调用 worker。

只想保留 worker、仅去掉原生模块？见 `references/native-host.md` 的回退说明。

## 7. 参考

- `.agent/example/native-host/` —— 上述可直接复制的源码。
- `references/native-host.md` —— native-host 架构、server/client API、重启与安全。
- `references/worker.md` —— worker SDK/RPC、日志、expose + grant。
- `references/manifest-schema.md` —— 每个 `dlient.*` 字段（`native`、`nativeModules`、`permissions` …）。
- `references/mode-switch-worker.md` —— 普通 worker 模式（不含原生模块）。
