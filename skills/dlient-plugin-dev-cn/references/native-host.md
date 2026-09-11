# 原生模块与 native-host 模式

原生模块（`.node`）绝不能加载进插件 worker——进程沙箱封禁 addon。dlient 提供两种跑原生模块的策略：

| | `dlient.native` | `dlient.nativeModules`（native-host，推荐） |
| --- | --- | --- |
| `.node` 存放 | `dist` 随包内置 | 插件 `node_modules`，用户侧 npm 安装 |
| ABI | Electron ABI（`@electron/rebuild`，逐平台） | **官方 Node ABI**（免 rebuild） |
| 分发 | 随 `.dlient` 内置（须声明 `platforms`） | 不入包——导入/安装时宿主按 `dlient.nativeModules.dependencies` 经 npm 用户侧安装 |
| 运行 | 专用 **official Node 子进程**（native-host）承载 | 同左 |

两者都跑在 **native-host**：宿主拉起并拥有的全权限官方 Node 子进程，运行你的 `dist/native-host.js`。本文聚焦 native-host 模式。

## 1. 为什么用 native-host

- 原生模块对齐**官方 Node ABI**（而非 Electron），不需要 `@electron/rebuild`。
- native-host 在沙箱外以全权限 Node 运行，原生模块直接可用。
- 宿主负责**拉起、按 owner 跟踪、worker 退出即回收、崩溃自动重启**（重启时在途 RPC 请求被 reject）。
- 一插件一 native-host，插件间不共享。

## 2. 架构与数据流

```
插件 worker（沙箱化、纯 JS）
   │  expose handler，如 my-plugin.query
   ▼
worker 侧客户端：createNativeHostClient({ transport: createHostedTransport(handle) })
   │  spawn（宿主 child.spawn）：cmd = 官方 node，args = [dist/native-host.js]，cwd = distDir
   ▼
宿主主进程：child.spawn（命令白名单）+ stdio pipe（双工）
   │  stdin/stdout 上的 length-prefixed JSON-RPC（handle.write / handle.end（child-control）、child-event）
   ▼
native-host.js（官方 Node，全权限）：createNativeHostServer()
   │  registerService('sqlite', { init/query/get/run/exec }, onClose?)
   ▼
原生模块经 createRequire 加载 → better-sqlite3 / ssh2 / …
```

跨管道只传 JSON 可序列化值。路径、id 等数据作为参数传入；native-host 不碰 DOM / Electron。

## 3. 脚手架

```bash
npx @dlient-open/create-plugin my-native-plugin --native-host
```

模板会生成：

- `src/native-host/index.ts` —— native-host 入口；
- `@dlient-open/native-host-sdk` 依赖；
- manifest 中的 `dlient.nativeModules`（填入 `dependencies`）。

`script/build-worker.mjs` 检测到 `src/native-host/` 即产出 **`dist/native-host.js`**（esbuild，`platform: node`）。

## 4. Manifest

```jsonc
"dlient": {
  "nativeModules": {
    "dependencies": { "better-sqlite3": "^11.0.0" },   // 包 → 版本，精确安装
    "useBundledNode": true                               // 默认 true
  }
}
```

规则：

- `dependencies`：npm 包 → 版本/semver；由宿主在导入/安装时在插件目录 `node_modules` **用户侧安装**（开源版无市场；`.dlient`/dist **不含** `.node`、不含 `node_modules`）。
- 同时把模块加进 `devDependencies`（本地开发类型/构建期）。
- `useBundledNode`（默认 `true`）：native-host 必须用宿主内置 `nodejs` 运行时提供的官方 Node（缺失自动安装）；`false` = 可用 PATH 上任意 Node。
- 与 `native` **互斥**，不得同时声明；`native` 强制 `platforms`，`nativeModules` 不需要。

## 5. 编写 native-host（`src/native-host/index.ts`）

约束：**纯 Node**——只允许 `node:*` + 你的原生模块，不得依赖 electron / worker SDK。

```ts
// src/native-host/index.ts
import { createRequire } from 'node:module'
import { createNativeHostServer } from '@dlient-open/native-host-sdk'

const require = createRequire(import.meta.url)           // 从插件 node_modules 解析 .node
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

const host = createNativeHostServer()

host.registerService(
  'notes',
  {
    // params: unknown[] → 可序列化返回值（或直接 throw）
    query: (params) => db.prepare(String(params[0])).all((params[1] ?? []) as never[]),
    run: (params) => db.prepare(String(params[0])).run((params[1] ?? []) as never[]),
  },
  () => {
    db.close()           // 宿主关闭时的优雅清理
  },
)
```

- 方法是纯函数 `(params: unknown[]) => value`；方法内抛错在客户端变成 RPC 错误信封。
- service 状态是进程内单例：用懒初始化（例如 `init` 方法接收 worker 传来的数据目录）。
- native-host 单线程串行——对同步原生 API（better-sqlite3 风格）天然安全。

## 6. Worker 侧（客户端）

把 native-host 挂在托管子进程句柄上：

```ts
// src/main/index.ts
import { createWorkerRpc } from '@dlient-open/plugin-sdk'
import { createHostedTransport, createNativeHostClient, createRestartableNativeHost } from '@dlient-open/native-host-sdk'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const rpc = createWorkerRpc('my-native-plugin')

const buildHost = () =>
  createRestartableNativeHost({
    maxRestarts: 3,                                // 连续崩溃/无 node 时快速置死报错
    // 首次调用与每次崩溃后都会执行 spawn：
    spawn: async () => {
      // 解析官方 node（宿主内置运行时；声明 nodejs.resolveRuntime——缺失自动安装）
      const rt = (await rpc.nodejs.resolveRuntime({ version: '22' })) as { node?: string }
      if (!rt.node) throw new Error('node runtime not available')
      const distDir = fileURLToPath(new URL('.', import.meta.url))   // worker.js 与 native-host.js 同在 dist/
      const entry = join(distDir, 'native-host.js')
      const handle = await rpc.child.spawn({
        cmd: rt.node, args: [entry], cwd: distDir,
        description: 'native-host (native modules)',
      })
      // 经 ChildHandle 的 stdio 双工 transport
      const client = createNativeHostClient({ transport: createHostedTransport(handle) })
      return { client }
    },
    // 新 host 就绪后（重新）初始化状态
    onRestarted: async (client) => {
      const userData = (await rpc.app.getPath('userData')) as string
      await client.call('notes', 'init', [join(userData, 'db')])
    },
    onExit: ({ code, reason }) => rpc.log('warn', 'native-host exited', { code, reason }),
  })

let host: ReturnType<typeof buildHost> | undefined
const ensureHost = () => (host ??= buildHost())       // 懒拉起；崩溃后下次调用自动重启

// 暴露给调用方，把调用方身份一并传给 native-host（纵深防御）
rpc.registerHandler('my-native-plugin.queryNotes', async (args, ctx) => {
  const h = await ensureHost()
  return h.call('notes', 'query', [String(args[0]), /* ... */ ctx.from_plugin_id])
})
```

要点：

- `rpc.nodejs.resolveRuntime` 返回官方 Node 可执行路径（配合 `useBundledNode`）；宿主在缺失时自动安装其内置运行时（在 `manifest.permissions` 声明 `nodejs.resolveRuntime`）。
- `createRestartableNativeHost` 提供：首调懒拉起、**崩溃自动重启**、重启期间在途请求 reject、`onRestarted` 钩子（重初始化）。
- 自己管句柄时用普通 `createNativeHostClient`：`createNativeHostClient({ transport: createHostedTransport(handle) })`（一次性工具等场景）。
- 多租户：native-host 无法得知调用方，由 worker 把调用方身份作为参数转发；native-host 侧再校验 id/路径（纵深防御，如按调用方分库文件）。

## 7. 生命周期与宿主

- native-host 本质是宿主代管的 `child.spawn`：命令过白名单（`spawnCmds` 覆盖解析出的 node 路径），必要时走运行时确认。
- 插件 worker 退出时宿主杀掉其 native-host（owner 回收）。一插件 → 一 native-host 进程。
- native-host 进程崩溃**不会**拖垮 worker——SDK 自动重启，worker 继续服务。

## 8. 安全说明

- native-host 是**全权限** Node：安装/使用它视为**安装级信任**（安装时 UI 显著提示风险）。
- 保持窄面：只暴露你的 service JSON-RPC，校验每个参数（插件 id 白名单、路径校验），不要向调用方透传全权限。
- 权限判定放在 worker（走常规权限模型）；native-host 侧校验作为纵深防御。

## 9. 参考与示例

- 模板：`npx @dlient-open/create-plugin my-plugin --native-host` 生成的 `src/native-host/index.ts`。
- SDK：`@dlient-open/native-host-sdk` —— `client.ts` / `server.ts` / `protocol.ts` 及 `example-host.ts`（transport / client / server API）。
