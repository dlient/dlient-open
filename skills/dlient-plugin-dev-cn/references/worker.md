# Worker 端编写说明

Worker 是纯 Node 进程（Electron utilityProcess）——无 DOM、无渲染层，唯一的出路是 host-api 与跨插件 RPC。

## 1. 入口与构建

- 源码：`src/main/index.ts`（模板默认）。
- 构建：`node script/build-worker.mjs` → **`dist/worker.js`**。
- 宿主只在 `dist/worker.js` 存在且 manifest `type` 含 worker（`full`、`worker`、带 worker 文件的 `app`）时才 fork；`ui` 插件绝不 fork。
- 有无 worker 由 `type` 决定；启动要**幂等**注册 handler（热重载会重跑本文件）。

## 2. 完整示例

以下是 `full`/`worker` 插件 worker 的典型完整写法（模板 + 常用能力）：

```ts
/**
 * my-plugin worker (src/main/index.ts)
 */
import { createWorkerRpc, PluginError, type WorkerRpc } from '@dlient-open/plugin-sdk'

const rpc: WorkerRpc = createWorkerRpc('my-plugin')
// 日志：rpc.log.write(level, message, data?)——声明 manifest.permissions 的 log 即可，无需 fs 权限

// ---- 1. 向其它插件暴露方法（须与 manifest.dlient.expose 对应）----
rpc.registerHandler('my-plugin.greet', async ([name]: [string?]) => `hello ${name ?? 'world'}`)

rpc.registerHandler('my-plugin.getConfig', async () => {
  // 插件隔离 JSON 存储（权限：app.data）
  return (await rpc.app.data.read('config.json')) as Record<string, unknown>
})

rpc.registerHandler('my-plugin.saveNote', async ([note]: [string]) => {
  if (!note || typeof note !== 'string') throw new PluginError(-3001, 'note required')
  await rpc.app.data.write('note.txt', { text: note, ts: Date.now() }) // 隔离存储（app.data）
  void rpc.log.write('info', 'note saved', { len: note.length })
  return { ok: true }
})

rpc.registerHandler('my-plugin.readPath', async ([path]: [string]) => {
  // 经宿主读取任意文件——需要 fs.read + 该路径的 fsDirs/授权
  return rpc.fs.read(path)
})

// ---- 2. fs.watch 事件作为宿主回调到达 ----
rpc.registerHandler('my-plugin.fs-watch-event', ([watchId, filename]) => {
  void rpc.log.write('info', 'fs watch', { watchId, filename })
})

// ---- 3. 启动：常驻任务 + 托管子进程 ----
async function boot(): Promise<void> {
  const cfg = (await rpc.app.data.read('config.json').catch(() => ({}))) as Record<string, unknown>

  // 托管 git 子进程（流式）
  const git = await rpc.child.spawn({ cmd: 'git', args: ['status', '--short'], description: 'git status' })
  git.onStdout((chunk) => void rpc.log.write('info', 'git out', chunk))
  git.onExit(({ code }) => void rpc.log.write('info', 'git exit', { code }))

  // 一次性捕获
  const { stdout } = await rpc.child.execFile({ cmd: 'node', args: ['--version'] })
  void rpc.log.write('info', 'node', stdout.trim())
}

boot().catch((err) => void rpc.log.write('error', 'boot failed', err))
```

示例要点：

- **绝不要**为特权资源触碰 `node:fs` / `child_process` / `net` socket——一律走 `rpc.{module}.{method}`。
- 在启动时（或之前）注册 handler，并保持幂等以兼容热重载。
- 用 `PluginError` 抛结构化错误；面向用户的文案留在 UI 侧。
- `rpc.child.spawn`/`rpc.child.execFile` 是 `child.*` 的 SDK 封装——拿到 `ChildHandle`，宿主负责清理。

## 3. WorkerRpc API

接口定义在 `@dlient-open/plugin-sdk`（`WorkerRpc`）。完整成员表：

| 成员 | 说明 |
| --- | --- |
| `registerHandler(method, handler)` | 注册可调用方法（跨插件需配合 `manifest.expose`） |
| `registerStreamHandler(method, handler)` | 流式 handler：可多次 `ctx.emit(chunk)`；return 后自动发 `stream-done` |
| `registerSnapshotHandler(fn)` / `registerRestoreHandler(fn)` | 热重载 / 重启时的业务状态快照与恢复 |
| `rpc.{module}.{method}(...args)` | 调用宿主能力（见 host-api 参考）；方法名 = host-api key，与 `manifest.permissions` 一致；`rpc.child.spawn/execFile` 为 SDK 封装 |
| `rpc.plugin.invoke(pluginId, method, args?)` | 跨插件调用（等价 `plugin.invoke`） |
| `rpc.plugin.requestGrant(pluginId, method, data?)` | 主动向目标插件请求授权（allow/ask/deny 三态）→ `{ allowed, scope?, reason? }` |
| `push(event, data?)` | 推送事件给绑定本插件的渲染层视图（UI 侧经 `api.onEvent` 订阅） |
| `rpc.log.write(level, message, data?)` | 上报日志（`info`/`warn`/`error`/`debug`） |
| `success(data?)` / `error(code, msg?)` | 构造 `{ code, data/msg, from }` 信封（handler 裸 return 会自动归一，一般无需显式调用） |
| `effect(install)` | 可逆副作用：`install()` 返回 disposer，宿主停止 worker 前逆序执行 |
| `onReady(cb)` | 控制面/直连通道就绪后触发一次 |
| `onDispose(cb)` | 宿主停止前清理回调（先于 effect disposers 执行；可返回 Promise） |
| `registerChildEvent(handleId, handlers)` / `unregisterChildEvent(handleId)` | 托管子进程的 child-event 分发 |
| `getPluginId()` | 运行标识（正式 `<id>`；dev 实例 `<id>@dev`） |

> 这里没有 `useEffect`/React：worker 是纯 Node、无 DOM。副作用清理与事件订阅/退订发生在 **UI 侧**（`useEffect` + `api.onEvent`，见 `ui.md`）。

### 3.1 成员示例

公共前提：

```ts
import { createWorkerRpc } from '@dlient-open/plugin-sdk'
const rpc = createWorkerRpc('my-plugin')
```

**registerHandler**

```ts
rpc.registerHandler('my-plugin.sum', async ([a, b]) => (a as number) + (b as number))

// 直连/跨插件调用还会收到 HandlerContext：
rpc.registerHandler('my-plugin.todo', async ([task], ctx) => {
  console.log('调用方', ctx.from_plugin_id, '请求', ctx.request_id)   // 另有 ctx.signal / ctx.data / ctx.emit
  return { task, ok: true }
})
```

**registerStreamHandler** —— 多次 `ctx.emit(chunk)`；return 后自动发 `stream-done`：

```ts
rpc.registerStreamHandler('my-plugin.tail', async (_args, ctx) => {
  for (let i = 0; i < 10; i++) {
    if (ctx.signal.aborted) return           // UI 已 cancel
    ctx.emit?.({ n: i })
  }
})
```

**registerSnapshotHandler / registerRestoreHandler** —— 热重载 / 重启时的业务状态：

```ts
rpc.registerSnapshotHandler(() => ({ counter }))
rpc.registerRestoreHandler((snap) => { counter = (snap as { counter?: number }).counter ?? 0 })
```

**rpc.{module}.{method}** —— 调用宿主能力的唯一方式（方法名 = host-api key，与 `manifest.permissions` 一致）：

```ts
const cfg = await rpc.app.data.read('settings.json')
await rpc.app.data.write('settings.json', { theme: 'dark' })
await rpc.fs.read('C:/tmp/a.txt')                        // 需权限 fs.read
const handle = await rpc.child.spawn({ cmd: 'git', args: ['status'] })   // 需权限 child.spawn；返回 ChildHandle
```

**rpc.plugin.invoke** —— 调用其它插件的 expose 方法：

```ts
const cfg = await rpc.plugin.invoke('plugin-auth', 'plugin-auth.getConfig')
```

**push** —— 推事件给本插件渲染层视图：

```ts
let n = 0
setInterval(() => rpc.push('my-plugin.progress', { n: ++n }), 1000)
// UI 侧：api.onEvent('my-plugin.progress', ({ n }) => …)
```

**log**

```ts
void rpc.log.write('info', 'worker boot', { version: '1.0.0' })
```

**success / error** —— 构造信封（handler 裸 return 会自动归一，仅需显式控制时用）：

```ts
rpc.registerHandler('my-plugin.div', ([a, b]) => {
  if ((b as number) === 0) return rpc.error(-3010, 'division by zero')
  return rpc.success((a as number) / (b as number))
})
```

**effect** —— 可逆副作用；返回的 disposer 在宿主停止前逆序执行：

```ts
rpc.effect(() => {
  const timer = setInterval(() => rpc.push('my-plugin.tick', { at: Date.now() }), 1000)
  return () => clearInterval(timer)          // disposer：宿主停止时逆序执行
})
```

**onReady / onDispose**

```ts
rpc.onReady(() => rpc.log('info', 'channels ready'))

rpc.onDispose(async () => { await releaseResources() })   // 先于 effect disposers 执行
```

**registerChildEvent / unregisterChildEvent** —— 通常直接用 `rpc.child.spawn` 返回的 `ChildHandle`；需要手动接管时才用：

```ts
const { handleId } = await rpc.child.spawn({ cmd: 'git', args: ['status'] })
rpc.registerChildEvent(handleId, {
  onStdout: (chunk) => process.stdout.write(chunk),
  onExit: ({ code, reason }) => void rpc.log.write('info', 'child exit', { code, reason }),
})
// 之后：
rpc.unregisterChildEvent(handleId)
```

**getPluginId** —— 运行标识（正式 `<id>`；dev 实例 `<id>@dev`）：

```ts
if (rpc.getPluginId().endsWith('@dev')) void rpc.log.write('warn', 'running as dev instance')
```

## 4. 向其它插件暴露方法

### 4.1 expose 策略——尽量少暴露

- **除非其它插件确实必须调用本插件，或用户明确要求，否则不要添加 `dlient.expose` 条目。** 每暴露一个方法都会扩大跨插件攻击面。
- 插件能暴露方法的**唯一条件**是它真的带 worker —— 即构建产物包含 `dist/worker.js`。manifest 的 `type` 与能否暴露无关：带 `dist/worker.js` 的 `app` / `ui` 插件**也能**暴露（注册 handler 的正是 worker）；而没有 `dist/worker.js` 的插件不能暴露 —— 没有任何东西能承载该调用，宿主会以 `WORKER_NOT_RUNNING`（`-2102`）拒绝。
- 有 worker 的插件（`full` / `worker`，或任何带 `dist/worker.js` 的插件）通常才声明 `expose`。
- 暴露一个方法需要**两半俱全**：在 worker 中注册 handler（`rpc.registerHandler('<plugin-id>.<method>', handler)`），**并且**在 `dlient.expose` 中声明完整点分 key。

### 4.2 暴露一个方法

```ts
rpc.registerHandler('my-plugin.greet', async ([name]) => `hello ${name}`)
```

在 manifest 中用**完整点分 key**加守卫：

```jsonc
"expose": { "my-plugin.greet": { "description": "…", "access": "public" } }
```

其它插件在 `dependencies` 声明后调用 `rpc.plugin.invoke('my-plugin', 'my-plugin.greet', ['world'])`（未声明 `dependencies` 时需已有授权记录或被调用方 `grant`）。access 档位：`private`（仅自己）/ `default`（宿主 + 自己）/ `system`（宿主内部——开源版无 system 插件）/ `public`（任意）/ `install-confirm` / `runtime-confirm`（可用 `|` / `&` 组合；见 manifest 参考）。`paramsSchema` **仅用于文档 / 表单生成**——宿主不在运行时据此校验参数。

### 4.3 `grant` handler

当调用方需要授权（或主动调用 `requestGrant`）时，宿主会调用被调用方 worker 的特殊 `grant` handler。用字面量 key `grant` 注册：

```ts
rpc.registerHandler('grant', async ([req]: [{ method: string; plugin_id: string; version?: string; org?: string; data?: unknown }]) => {
  return { status: 'ask' }   // 'allow' | 'ask' | 'deny'
})
```

它必须与 manifest `expose` 中的对应条目配套：

```jsonc
"expose": { "grant": { "description": "…", "access": "default" } }
```

| `status` | 含义                                                                         |
| -------- | ------------------------------------------------------------------------------- |
| `allow`  | 对该调用方 + 方法永久授权（不再弹窗）                    |
| `ask`    | 用户获得三选确认框：拒绝 / 仅本次允许 / 始终允许 |
| `deny`   | 拒绝                                                                         |

指引：

- **优先 `ask`**——让用户在调用时决定。
- 只要方法涉及用户隐私、密码、密钥、token 或其它敏感信息，就返回 **`deny`**。
- 仅对明确无害、不敏感的方法才返回 **`allow`**。

若被调用方**未**暴露 `grant`，未授权的跨插件调用会以 `ACCESS_DENIED` 失败。调用方也可主动询问：

```ts
const { allowed, scope, reason } = await rpc.plugin.requestGrant('my-plugin', 'my-plugin.greet', { name: 'world' })
```

### 4.4 密钥

- 密码、密钥与 token 必须**先用 `rpc.app.crypt.encrypt(plain)` 加密再存储**（如存入 `app.data`），读回时用 **`rpc.app.crypt.decrypt(ciphertext)` 解密**。
- `app.data.read` / `app.data.write` 是明文的隔离存储——**绝不**在其中明文写入密钥。
- **绝不记录或返回明文密钥**（不要 `rpc.log.write` 密钥，也不要在跨插件响应里放明文密钥）。

## 5. 日志

```ts
void rpc.log.write('info', 'boot ok', { version: '1.0.0' })  // 级别 debug/info/warn/error
void rpc.log.write('warn', 'slow path')
void rpc.log.write('error', 'boom', new Error('…'))
```

日志为 JSONL，落在 `USER_DATA/plugin-data/<插件id>/logs/main.log`（source='worker'）。直接读该文件或经日志 host-api 拉取。**无需声明 fs 权限**——只要 manifest.permissions 声明 `log` 即可；未声明则宿主拒绝（-2107）并写入该插件日志。

## 6. 宿主代管子进程 — `rpc.child.spawn` / `ChildHandle`

worker **不能自己 spawn**。由主进程经 `child.spawn` / `child.execFile` 代劳，先过命令白名单（`spawnCmds`）或 `spawn-confirm` 运行时授权。下面的 SDK 封装是插件唯一应使用的 spawn 入口。

### 6.1 `rpc.child.spawn` —— 流式子进程

```ts


const handle = await rpc.child.spawn({
  cmd: 'git',
  args: ['status', '--short'],
  cwd: '/work',
  env: { MY_FLAG: '1' },          // 叠加在剥离后的宿主 env 上（保留 PATH/HOME）
  description: 'git status in workspace',   // spawn-confirm 弹框展示文案
})

handle.onStdout((chunk) => console.log(chunk))   // child-event 流式
handle.onStderr((chunk) => console.error(chunk))
handle.onExit(({ code, reason }) => console.log('exit', code, reason)) // reason: 'exited' | 'killed'
handle.onError((err) => console.error('spawn 失败', err.message))       // 如命令不存在

await handle.kill()               // 树杀 + 注销（幂等；已退出则 no-op）
await handle.write('input line\n') // 写 stdin（child-control write；native-host RPC 双通用）
await handle.end()                 // 优雅关闭 stdin（child-control end）
```

**`SpawnHostedOptions`**：`cmd: string`（必填）· `args?: string[]` · `cwd?: string` · `env?: Record<string, string>`（叠加到剥离后 env）· `detached?: boolean` · `description?: string`（弹框文案）。

**`ChildHandle` 成员**：

| 成员 | 说明 |
| --- | --- |
| `handleId: string` | 宿主侧句柄 id（`child-control` / `child-subscribe` 内部消息用） |
| `pid: number` | 只读 pid（仅诊断——不能裸杀） |
| `kill(): Promise<void>` | 幂等树杀 + 注销；已退出 no-op |
| `readOutput()` | 轮询缓冲输出/退出态 → `{ stdout, stderr, exited, code, signal }` |
| `onStdout(cb)` / `onStderr(cb)` | 流式输出块（child-event 推送；各一个回调，重新赋值即替换） |
| `onExit(cb)` | `{ code, signal?, reason: 'exited' \| 'killed' }` |
| `onError(cb)` | spawn 失败（如命令不存在） |
| `write(chunk)` / `end()` | 写 / 关闭 stdin（child-control `write` / `end`） |

- stdout/stderr/exit/error 由主进程经控制面 **child-event** 推送，SDK 分发到回调。
- 宿主按 owner 跟踪进程，worker 退出/重启时自动回收——无需手写清理钩子。

### 6.2 `rpc.child.execFile` —— 一次性捕获

```ts
const { stdout, stderr, code } = await rpc.child.execFile({
  cmd: 'node', args: ['--version'],
  timeout: 10_000,          // 可选：超时自动杀
  description: 'detect node version',
})
```

返回 `{ stdout, stderr, code }`；用于探测类（如 `node --version`）。

### 6.3 命令授权与 SDK 内部

- 免确认放行：插件目录 / `DATA` / `node_modules/.bin` 下的可执行文件。其它命令需 `manifest.dlient.spawnCmds`（string = 仅命令；`{ cmd, argsPattern }` 约束参数）或运行时 `spawn-confirm`。
- `rpc.child.spawn` 内部 = `child.spawn` + `rpc.registerChildEvent(handleId, …)`；`kill()` 会注销 child-event 监听。优先用封装，不要直接碰 `child.*` 或 `registerChildEvent`。
- `spawnTracked` / `killTracked`（旧 API，基于 `child.register`）仅为旧流程保留；新代码一律用 hosted 封装。

### 6.4 原生工具与常驻进程

- 原生模块 / 需要完整 Node 环境的工具跑 **native-host** 子进程——见 `references/native-host.md`。
- 类 server 的常驻进程也应是托管子进程（worker 退出即被回收）；不要跑在 worker 事件循环里。

## 7. 调用其它插件

```ts
const cfg = await rpc.plugin.invoke('plugin-auth', 'plugin-auth.getConfig')
```

宿主先校验你的 `manifest.dependencies` 声明与目标 `expose` 档位再转发。

## 8. 结构化错误

```ts
import { PluginError } from '@dlient-open/plugin-sdk'
throw new PluginError(-3010, 'config missing')   // 错误码段 -3001..
```

返回错误码 / 多语言消息；面向用户的文案留在 UI 侧。

## 9. 生命周期与长时运行

- 保持事件循环活跃。**绝不同步阻塞**（禁用 `spawnSync`、同步文件 I/O）：事件循环冻结时，宿主会重启你的 worker。
- 启动时重新注册 handler（热重载重跑 `dist/worker.js`）。
- worker 退出后，宿主回收其名下全部资源：子进程、托管 spawn 句柄、日志订阅。
