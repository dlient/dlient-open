# 模式切换：仅 UI（`default`）→ worker（UI + worker）

本指南把**仅 UI** 插件（脚手架不带任何 flag）转换为 **worker** 模式：UI 之外再补一个跑在沙箱化
Node 进程里的 worker。`default` 与 `native` 模板在各自的 `.agent/AGENTS.md` 中引用的
就是本指南。

可直接复制的源码见 `.agent/example/worker/`。

## 1. 何时选此模式

当插件需要一些不属于渲染层的工作时，选 `worker`：

- RPC、常驻任务、定时器、后台同步；
- 经 host-api 访问文件 / 网络 / 子进程（`rpc.fs.*`、`rpc.net.*`、`rpc.child.*`）；
- 需要在视图重载后存活的状态（快照 / 恢复）；
- **其它插件**要调用的方法。

**不要**在 UI 已足够时再加 worker。仅 UI 插件更简单、攻击面更小——没有额外进程需要沙箱、授权
与清理。UI 能直接调 `api.*` 就保持 `default`。

仅 UI 插件**不得**声明 `dlient.expose`：没有 worker 来承载 handler，跨插件调用会以
`WORKER_NOT_RUNNING`（`-2102`）失败。

## 2. 需要新增的文件

从 `.agent/example/worker/` 复制：

| 从 `.agent/example/worker/` 复制 | 到（工程） | 说明 |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | worker 入口——`createWorkerRpc('<plugin-id>')`，一个示例 handler + `grant` handler |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild 构建 → `dist/worker.js`（若存在 `src/native-host/` 也会产出 `dist/native-host.js`） |

示例用占位符 `__PLUGIN_ID__`——替换为你的插件 id（脚手架生成工程时已自动替换）。

最终布局（worker 专属文件以 `+` 标注）：

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
│   └── renderer/               # UI（不变）
└── .agent/
```

## 3. `package.json` 改动

### 3.1 `scripts`

新增 `build:worker` 与 `dev:watch:worker`，把 `build:worker` 追加进 `build` 链，并为合并的
`dev` watch 加上 `concurrently`：

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

| 改动 | 原因 |
| --- | --- |
| `build:worker` → `node script/build-worker.mjs` | 产出 `dist/worker.js` |
| `dev:watch:worker` → `node script/build-worker.mjs --watch` | 变更即重建 worker |
| `build` 追加 `&& npm run build:worker` | 一次 `npm run build` 仍能构建全部 |
| `dev` → `concurrently -k …` | 同时跑 UI 与 worker 两个 watcher |

### 3.2 devDependencies

```jsonc
"devDependencies": {
  "esbuild": "^0.20.0",
  "concurrently": "^9.1.0"
}
```

`esbuild` 为 `script/build-worker.mjs` 所需；`concurrently` 仅在合并的 `dev` 脚本里需要。改完执行
`npm install`。

### 3.3 manifest 形态

严格来说无需新增 manifest 字段——`dist/worker.js` 存在且 manifest `type` 允许时（`full`、`worker`
或 `app`），宿主就会 fork worker。模板保留 `"type": "app"`；若你偏好显式的 UI + worker 形态，改为
`"type": "full"`（见 `references/manifest-schema.md`）。

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
> manifest 的 `type` 与能否暴露无关，因此 `full` / `worker` 以及任何带 `dist/worker.js` 的 `app` / `ui`
> 插件都符合条件，而没有 `dist/worker.js` 的插件则不能（没有任何东西能承载该调用 → `WORKER_NOT_RUNNING`、
> `-2102`）。真要暴露时：
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
npm run build         # → dist/remoteEntry.js (UI) + dist/worker.js (worker)
```

确认 `dist/worker.js` 存在。宿主只在文件存在时才 fork worker。

**确认宿主加载**

1. dev 流程：把工程放进 `dlient-open/plugins/<插件id>` 并执行 `npm run dev`（产物级 watch）。
   重开 / 重载宿主以拾取变更。
2. 导入流程：`npm run pack`，宿主操作台 →「导入插件」→ 选择 `.dlient`。
3. 查看 `USER_DATA/plugin-data/<插件id>/logs/main.log`（`USER_DATA` = `~/.dlient-open`）——应能看到
   worker 的 `log` 行（如示例 `greet` handler 产生的）。

**回退（回到仅 UI）**

- 删除 `src/main/` 与 `dist/worker.js`；
- 从 `build` 链移除 `build:worker`、`dev:watch:worker` 脚本与 `&& npm run build:worker` 步骤
  （若 `esbuild` 别无他用一并移除）；
- 移除 `dlient.expose` 与 `skills/`；
- 确认 UI 不再调用 worker（`api.request(...)` / worker RPC）。

## 7. 参考

- `.agent/example/worker/` —— 上述可直接复制的源码。
- `references/worker.md` —— worker SDK/RPC、日志、子进程句柄、expose + grant。
- `references/native-host.md` —— 在 worker 之上再加原生 `.node` 模块。
- `references/manifest-schema.md` —— 每个 `dlient.*` 字段（`type`、`permissions`、`expose` …）。
- `references/mode-switch-native-host.md` —— 再上一档（worker + 原生模块）。
