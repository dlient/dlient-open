# 示例：native-host 模式（UI + worker + 原生模块）

把插件转换为 **native-host** 模式的可直接复制源码：UI + worker + 由专用**全权限官方 Node 子进程**
加载的原生 `.node` 模块（无需 `@electron/rebuild`）。该子进程由宿主代表 worker 拉起，并与 worker
以 JSON-RPC 通信。

## 文件

| 文件 | 复制到 | 用途 |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | worker 入口——经 `@dlient-open/native-host-sdk` 拉起 native-host 子进程并转发调用；同时注册 `grant` handler |
| `src/native-host/index.ts` | `src/native-host/index.ts` | native-host 入口——纯 Node，加载原生模块并注册 service |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild 构建 → `dist/worker.js` 以及（因存在 `src/native-host/index.ts`）`dist/native-host.js` |

`__PLUGIN_ID__` 是插件 id 的占位符；替换为真实 id（脚手架生成工程时会自动替换）。

## 两半如何连接

```
worker (src/main/index.ts, sandboxed)
  └─ createRestartableNativeHost → rpc.child.spawn(official node, dist/native-host.js)
       └─ native-host (src/native-host/index.ts, full permission, pure Node)
            └─ native module loaded via createRequire from node_modules
```

## 接着阅读

- `references/mode-switch-native-host.md` —— 逐步说明 manifest、`scripts` 与 `package.json` 的改动。
- `references/native-host.md` —— native-host 架构、server/client API、重启与安全。
- `references/worker.md` —— worker SDK/RPC 参考（handler、日志、expose + grant）。
- `references/manifest-schema.md` —— 每个 `dlient.*` manifest 字段。

> 在生成的工程里，这些文档位于 `.agent/references/` 下。
