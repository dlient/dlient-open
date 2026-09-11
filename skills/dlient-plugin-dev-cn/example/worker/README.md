# 示例：worker 模式（UI + worker）

把仅 UI（`default`）插件转换为 **worker** 模式的可直接复制源码。
worker 是沙箱化的纯 Node 进程，经 **host-api**（`rpc.*`）访问宿主。

## 文件

| 文件 | 复制到 | 用途 |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | worker 入口——`createWorkerRpc('<plugin-id>')`，一个示例 handler 与 `grant` handler |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild 构建 → `dist/worker.js`（若存在 `src/native-host/index.ts` 也会产出 `dist/native-host.js`） |

`__PLUGIN_ID__` 是插件 id 的占位符；替换为真实 id（脚手架生成工程时会自动替换）。

## worker 注册了什么

| Handler | 类型 | 说明 |
| --- | --- | --- |
| `__PLUGIN_ID__.greet` | 示例方法 | 宿主 + 本插件可调用。仅当其它插件必须调用时才添加 `dlient.expose` 条目。 |
| `grant` | 特殊 handler | 宿主在跨插件授权时调用；返回 `{ status: 'ask' \| 'allow' \| 'deny' }`。仅当 `dlient.expose` 声明了对应的 `"grant"` 条目时才生效。 |

## 接着阅读

- `references/mode-switch-worker.md` —— 逐步说明 manifest、`scripts` 与 `package.json` 的改动。
- `references/worker.md` —— 完整 worker SDK/RPC 参考（handler、日志、子进程、expose + grant）。
- `references/manifest-schema.md` —— 每个 `dlient.*` manifest 字段。

> 在生成的工程里，这些文档位于 `.agent/references/` 下。
