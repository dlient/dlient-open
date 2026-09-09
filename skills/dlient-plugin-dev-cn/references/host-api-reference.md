# 宿主 API 参考

主进程暴露固定的 RPC 面。Worker 通过 `rpc.{module}.{method}(...args)` 调用。每次调用都先过两道校验再执行：

1. **方法权限** —— 插件必须在 `manifest.permissions` 声明对应能力，否则宿主抛 `PERMISSION_DENIED`（`-2107`）；
2. **资源白名单** —— `fs.*`、`net.*`、`child.*`、`dialog.*` 按资源授权表校验路径 / URL / 命令（DATA、fsDirs、grants、确认弹框）。

所有方法均异步、返回可序列化值。错误携带 `DlientErrorCode`（`-2107` 拒绝、`-1005` 非法、`-1003` 用户拒绝、`-1006` 对话框取消等）。

## 0. 调用方式

```ts
import { createWorkerRpc } from '@dlient-open/plugin-sdk'
const rpc = createWorkerRpc('my-plugin')

const content = await rpc.fs.read('C:/tmp/a.txt')          // string
await rpc.fs.write('C:/tmp/out.bin', { base64: 'aGVsbG8=' }) // 二进制
const userData = await rpc.app.getPath('userData')          // 无需权限
```

- `fs.read`/`fs.write`/`app.data.*` 返回/接收 JSON 安全值；二进制以 `{ base64: string }` 传输。

- 宿主内部助手（`child.register`/`unregister`/`killTree`、`plugins.registry.*`、dev 管道）不在此文档，请用 SDK 封装。

> **类型单源**：全部 host-api 的签名 / options / 返回 / 英文注释集中在 `@dlient-open/api-types`（真源 = 主进程 `app/src/main/api/*`）。Worker 端经 `@dlient-open/plugin-sdk`、UI 端经 `@dlient-open/api-bridge` 透出；修改 host-api 时先同步 `api-types/src/modules/*`，两端类型自动跟随。
>
> **仅列插件可调用的 API**：本文只收录普通插件（local / dev）可调用的 host-api。api 表每项带 **scope**（调用通道门禁：`all` / `worker` / `ui` / `system`）与 **level**（安装风险标签，导入确认框按此显示：`default` 灰 / `warn` 橙 / `dangerous` 红）。**system scope API**（`os.openExternal`、`os.showItemInFolder`、`permission.revoke`、`plugin.capabilities`、`plugin.start/stop` 等）**不在此列出**——开源宿主**无 system 插件**，普通插件调用会抛 `PERMISSION_DENIED`（`-2107`，system-only）。

## 1. 文件系统 — `fs.*`

| 方法            | 参数（类型）                                                                | 权限          | 用途                                                                                        |
| ------------- | --------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `fs.read`     | `(path: string)`                                                      | `fs.read`   | 读 UTF-8 文本文件 → `string`                                                                   |
| `fs.write`    | `(path: string, data: string \| { base64: string })`                  | `fs.write`  | 原子写（tmp + rename）                                                                         |
| `fs.append`   | `(path: string, data: string \| Buffer)`                              | `fs.write`  | 追加文本/二进制                                                                                  |
| `fs.delete`   | `(path: string)`                                                      | `fs.delete` | 递归删除文件/目录                                                                                 |
| `fs.stat`     | `(path: string)`                                                      | `fs.read`   | 状态；不存在抛错                                                                                  |
| `fs.listDir`  | `(path: string)`                                                      | `fs.read`   | → `[{ name, isDirectory, isFile, size, mtimeMs }]`                                        |
| `fs.watch`    | `(path: string)`                                                      | `fs.watch`  | 监听目录 → `watchId`；事件经 `registerHandler('<插件id>.fs-watch-event')` 推送为 `[watchId, filename]` |
| `fs.unwatch`  | `(watchId: string)`                                                   | `fs.watch`  | 停止监听                                                                                      |
| `fs.copyDir`  | `(src: string, dest: string, exclude?: string[])`                     | `fs.write`  | 拷贝目录树；`dest` 必须在 `userData` 内                                                             |
| `fs.lock`     | `(path: string, opts?)`                                               | `fs.write`  | 跨进程锁 → `{ lockId }`                                                                       |
| `fs.unlock`   | `(path: string, lockId: string)`                                      | `fs.write`  | 释放锁                                                                                       |
| `fs.withLock` | `(path: string, op: { method: 'read'\|'write'\|'append', … }, opts?)` | `fs.write`  | 持锁执行单次操作                                                                                  |

示例：

```ts
const text = await rpc.fs.read('C:/tmp/a.txt')
await rpc.fs.write('C:/tmp/out.txt', 'hello')
await rpc.fs.write('C:/tmp/img.png', { base64: b64 })
await rpc.fs.copyDir('C:/src', 'C:/dest', ['node_modules', '.git'])
const watchId = await rpc.fs.watch('C:/src')   // 事件 → registerHandler('<id>.fs-watch-event')
```

路径**先做 realpath 安全解析再授权**（拦截符号链接逃逸）。`DATA` 默认授予；其余路径需 `fsDirs` 或授权。

## 2. 网络 — `net.*`

当前 worker 注入 `--allow-net`（临时策略，允许直接 `node:net`/`fetch`）。宿主 `net.*` 仍提供受控访问。

| 方法                | 参数（类型）                                                                     | 权限            | 用途                      |
| ----------------- | -------------------------------------------------------------------------- | ------------- | ----------------------- |
| `net.fetch`       | `(url: string, init?: { method?, headers?, body? }, description?: string)` | `net.request` | 抓取并返回完整响应               |
| `net.request`     | `(urlOrOptions, description?: string)`                                     | `net.request` | 底层请求                    |
| `net.getFreePort` | `()`                                                                       | —             | 分配空闲端口 → `number`       |
| `net.probePort`   | `(port: number)`                                                           | —             | 探测本机 TCP 就绪 → `boolean` |

示例：

```ts
const res = await rpc.net.fetch('https://api.example.com/data', { method: 'GET' }, 'fetch remote data')
const port = await rpc.net.getFreePort()
```

未授权 URL 触发 `net-access` 确认弹框；授权按域名 / URL 前缀存储。

## 3. 对话框 — `dialog.*`

| 方法                      | 参数（类型）                                                                                                             | 权限         | 用途                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------- |
| `dialog.showOpenDialog` | `(permissions: ('fs.read'\|'fs.write'\|'fs.delete')[], options: Electron.OpenDialogOptions, description?: string)` | 申请的 `fs.*` | 系统选择器 + 授权所选路径 → `{ filePaths, granted }` |
| `dialog.showSaveDialog` | `(options: Electron.SaveDialogOptions)`                                                                            | —          | 保存选择器 → `{ filePath }` + 保存会话写授权          |
| `dialog.showMessageBox` | `(options: Electron.MessageBoxOptions)`                                                                            | —          | 原生消息框                                     |

示例：

```ts
const { filePaths, granted } = await rpc.dialog.showOpenDialog(['fs.read'], { properties: ['openFile'] }, '选择要导入的配置')
const { filePath } = await rpc.dialog.showSaveDialog()
await rpc.fs.write(filePath, data)
```

> 选中并确认后即授予所选作用域授权；此后对所选路径的 `fs.*` 调用不再额外弹确认。

## 4. 子进程 — `child.*`

宿主代 spawn 并跟踪进程。优先用 SDK 封装 `rpc.child.spawn` / `rpc.child.execFile`（返回 `ChildHandle`）。

| 方法                 | 参数（类型）                                                                    | 权限            | 用途                                                                      |
| ------------------ | ------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `child.spawn`      | `({ cmd: string, args?: string[], cwd?, env?, detached?, description? })` | `child.spawn` | SDK `rpc.child.spawn` → `ChildHandle`（自动 child-subscribe 回放 + child-event 流式推送） |
| `child.execFile`   | `({ cmd: string, args?: string[], cwd?, env?, timeout?, description? })`  | `child.execFile` | 一次性捕获 → `{ stdout, stderr, code }`                                      |
| 句柄内聚（非 host-api） | — | — | `rpc.child.spawn` 返回的 `ChildHandle`：kill/stdin/事件经 `child-control` / `child-subscribe`；旧 `child.kill/readOutput/writeStdin/stdinEnd` 已删除 |

示例：

```ts


const handle = await rpc.child.spawn({ cmd: 'git', args: ['log', '-1'], description: '查看最近提交' })
handle.onStdout((chunk) => log.info('git', chunk))
handle.onExit(({ code, reason }) => log.info('exit', { code, reason }))
await handle.kill()

const { stdout } = await rpc.child.execFile({ cmd: 'node', args: ['--version'] })
```

命令授权：插件目录 / `DATA` / `node_modules/.bin` 放行；其它命令需 `spawnCmds` 或 `spawn-confirm`。违反 `argsPattern` → 硬拒绝。

## 5. App 与窗口 — `app.*`

| 方法                                                                           | 参数（类型）                                                                        | 权限                      | 用途                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `app.getVersion`                                                             | `()`                                                                          | —                       | 宿主版本 → `string`                                           |
| `app.getName`                                                                | `()`                                                                          | —                       | 应用名                                                       |
| `app.getLocale` / `app.getSystemLocale`                                      | `()`                                                                          | —                       | 当前 / 系统 locale                                            |
| `app.isActive` / `app.isHidden`                                              | `()`                                                                          | —                       | 窗口焦点 / 可见状态                                               |
| `app.getPath`                                                                | `(key: string)`                                                               | —                       | 路径：`userData`（隔离）、`home`、`documents`、`downloads`、`temp` 等 |
| `app.data.read`                                                              | `(file: string)`                                                              | `app.data`              | 读 `<userData>/plugin-data/<插件id>/<file>.json` → 解析 JSON   |
| `app.data.write`                                                             | `(file: string, data: unknown)`                                               | `app.data`              | 写隔离 JSON（原子）                                              |
| `app.crypt.encrypt` / `app.crypt.decrypt`                                    | `(payload)`                                                                   | `app.crypt`             | 每插件密钥加解密                                                  |
| `app.shortcut.register`                                                      | `(accelerator: string, cb: () => void)`                                       | `app.shortcut.register` | 注册全局快捷键                                                   |
| `app.shortcut.unregister`                                                    | `(accelerator: string)`                                                       | `app.shortcut.register` | 注销快捷键                                                     |
| `app.menu.popup`                                                             | `(items: MenuItemTemplate[])`                                                 | `app.menu`              | 原生右键菜单 → 被点击项 id                                          |
| `app.window.close/focus/blur/show/hide/maximize/unmaximize/minimize/restore` | `()`                                                                          | `app.window`            | 主窗口控制                                                     |
| `app.window.setFullScreen`                                                   | `(flag: boolean)`                                                             | `app.window`            | 全屏开关                                                      |
| `app.notify`                                                                 | `({ event: string, receiver?: string[], data?: unknown, event_id?: string })` | —                       | 发 NOTIFY 总线事件（渲染层 receiver）                               |
| `app.event`                                                                  | （订阅）                                                                          | `app.event`             | 转发宿主事件（主题 / 语言）                                           |
| `system.listenNativeTheme`                                                         | （订阅）                                                                          | `system.listenNativeTheme`    | 跟随系统主题                                                    |

示例：

```ts
const settings = (await rpc.app.data.read('settings.json')) as Record<string, unknown>
await rpc.app.data.write('settings.json', { theme: 'dark' })
await rpc.app.notify({ event: 'my-plugin.data-changed', data: { file: 'settings.json' } })
```

### 5.1 凭证与子进程（`app.crypt`）

`app.crypt.encrypt/decrypt` 是**每插件隔离**的 AES-256-GCM：插件密钥由宿主 master key 经 HKDF 派生（`info = pluginId`），master key 绝不离主进程，密文格式 `base64(version ‖ iv ‖ tag ‖ ct)`。同一插件跨会话/重启可解自己的密文；其它插件解不开（隔离）。

典型范式——明文凭证不落盘，再安全交给托管子进程：

```ts
// 1) 加密持久化（绝不存明文）
const enc = await rpc.app.crypt.encrypt(token)
await rpc.app.data.write('secrets.json', { gh: enc })

// 2) 之后（含 worker 重启后）：读取 → 仅内存解密
const stored = (await rpc.app.data.read('secrets.json')) as { gh?: string }
const token = await rpc.app.crypt.decrypt(String(stored.gh))

// 3) 传给托管子进程——绝不放命令行参数：
const handle = await rpc.child.spawn({
  cmd: 'git', args: ['push', 'origin', 'HEAD'],   // argv 不含 token
  cwd,
  env: { GH_TOKEN: token },                        // 只保留你显式传入的项（宿主剥离其余 env）
  description: 'git push',
})
handle.onStderr((c) => log.warn('git', c))
await handle.kill()
```

规则：

- **凭证绝不放** **`argv`** —— 会出现在进程列表、`spawn-confirm` 的完整命令行展示与宿主审计日志里。

- 经 `env`（只保留你显式传的项，宿主剥离其余）或 `stdin`（`handle.write`）传递；绝不写日志 / `console`。

- native-host 子进程同样是托管 spawn：在 worker 解密后经 `rpc.child.spawn` env 注入。子进程本身无法调用 `app.crypt`（密钥在主进程）——它只在进程存活期收到解密后的明文。

- 插件隔离：插件 A 加密的密文插件 B 解不开（HKDF info 不同）。不要把密文交给其它插件期待它解密。

### 5.2 内置 Node.js 运行时 — `nodejs.*`

开源宿主里 `nodejs` **不是插件**：运行时并入宿主主进程，作为普通 host-api 模块暴露（在 `manifest.permissions` 声明对应 `nodejs.*` key）。不再有 `plugin.invoke('nodejs', …)`——迁移到 `rpc.nodejs.*`。

| 方法 | 参数（类型） | 权限 | 用途 |
| --- | --- | --- | --- |
| `nodejs.checkLocal` | `({ version? })` | `nodejs.checkLocal` | 检测本地（PATH / 常见路径）Node 运行时 |
| `nodejs.checkBundled` | `({ version? })` | `nodejs.checkBundled` | 检测宿主内置运行时（`~/.dlient-open/plugin-data/nodejs`） |
| `nodejs.resolveRuntime` | `({ version? })` | `nodejs.resolveRuntime` | 解析可用运行时（内置优先、PATH 兜底）→ `{ node?, source, … }` |
| `nodejs.install` | `(version?)` | `nodejs.install` | 安装内置 LTS 运行时（单飞；下载到 userData 下） |

`dlient.nodeVersion`（或 nodejs 依赖项）触发宿主就绪门控：布局/启动器在满足前显示「未就绪」，把 `nodejs` 当作运行时占位（缺失自动安装）而非缺失插件。

## 6. 剪贴板

> `os.openExternal` / `os.showItemInFolder` 为 **system scope** API（开源版无 system 插件，普通插件不可达），不在此列出。

| 方法                                         | 参数（类型）                      | 权限                    | 用途           |
| ------------------------------------------ | --------------------------- | --------------------- | ------------ |
| `clipboard.readText`                       | `()` / `(type?)`            | `clipboard.read`      | 读剪贴板文本       |
| `clipboard.writeText`                      | `(text: string, type?)`     | `clipboard.write`     | 写剪贴板文本       |
| `clipboard.readHTML` / `writeHTML`         | `(type?)` / `(html, type?)` | read / write          | HTML         |
| `clipboard.readRTF` / `writeRTF`           | `(type?)` / `(rtf, type?)`  | read / write          | RTF          |
| `clipboard.readBookmark` / `writeBookmark` | `()` / `(title, url)`       | read / write          | 书签           |
| `clipboard.readImage` / `writeImage`       | `(type?)` / `(image)`       | read / write          | 图片           |
| `clipboard.readFindText` / `writeFindText` | `()` / `(text)`             | read / write          | 查找文本         |
| `clipboard.clear`                          | `(type?)`                   | `clipboard.write`     | 清空剪贴板        |
| `clipboard.availableFormats`               | `(type?)`                   | `clipboard.read`      | → `string[]` |
| `clipboard.has`                            | `(format, type?)`           | `clipboard.read`      | 是否含格式        |
| `clipboard.read` / `write`                 | （按格式）                       | read / write          | 通用格式读写       |
| `system.getIdleState`                      | `(thresholdSec)`            | `system.getIdleState` | 系统空闲状态       |

`type` 取值同 Electron：`'selection'` / `'clipboard'`（可选）。

## 7. 通知

> v2（docs/specs/notification-v2.md）：`send` 返回**句柄**，事件（click/close/reply/action/failed/show）经宿主回推；
> macOS 前台自动走内置通知条（右上角，非全屏）；`remove/removeGroup` 按 owner 校验、系统与内置双引擎生效。
> 渲染端 HTML5 `new Notification()` 已被宿主禁用，一律走本模块。

| 方法                                        | 参数（类型）                                                                    | 权限                        | 用途                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `notification.isSupported`                  | `()`                                                                        | —                          | 系统通知是否可用                                               |
| `notification.send`                        | `({ title, body?, silent?, hasReply?, replyPlaceholder?, actions?, closeButtonText?, timeoutType? })` | `notification.send`（或前缀组） | 发送通知 → 返回句柄 `{ id }`；`n.on("click"/"close"/"reply"/"action"/"failed"/"show", cb)` 监听事件；`n.close()` 关闭 |
| `notification.remove`                      | `(id)`                                                                      | `notification.remove`      | 关闭本插件发送的通知（owner 校验，他人 id → `PERMISSION_DENIED`；系统/内置双引擎）       |
| `notification.removeGroup`                 | `()`（不传组 id）                                                              | `notification.removeGroup` | 关闭本插件全部通知（含自定义 group_id）                               |
| `notification.subscribe` / `notification.unsubscribe` | `({ id })`                                                            | 免声明（owner 校验）             | 句柄事件订阅/退订（SDK 句柄自动调用，一般无需手调）                          |

> 身份字段（`group_id`=插件 instanceKey、`group_title`/`subtitle`=插件名 i18n、`icon`=插件图标）由主进程按发送插件身份**强制注入**，插件传入会被忽略；`hasReply` 默认 false、`actions` 默认 []、`timeoutType` 默认 `'default'`（Windows 系统引擎驻留用 `'never'`；内置引擎 `'never'` = 不自动消失）。
> 平台差异：`actions`/`hasReply` 仅 macOS 系统通知支持；Windows/Linux 系统通知只能点击，动作类能力由内置通知承载（macOS 前台自动命中）。

## 8. 跨插件调用与插件安装

> `plugin.start/stop`、`plugin.capabilities`、`permission.revoke` 等宿主管理 API 为 **system scope**——开源宿主无 system 插件，插件调不到。普通插件经 `plugin.invoke` 调用其它插件的 expose 方法（授权按 `dependencies` 前置 + 目标 `access`/`grant` / 用户三选确认）。`plugin.dev.*` / `plugin.logs.*` 原语为 **worker scope** host-api，供宿主仓库/dev 流程使用——插件一般无需直接调用。

| 方法 | 参数（类型） | 权限 | 用途 |
| --- | --- | --- | --- |
| `plugin.invoke` | `(targetPluginId: string, method: string, args: unknown[])` | — | 调用其它插件的 expose 方法（等价 `rpc.plugin.invoke`）；按 `dependencies` + 目标 `expose` 校验 |
| `plugin.requestGrant` | `(targetPluginId, method, data?)` | — | 主动向目标插件请求授权 → `{ allowed, scope?, reason? }` |
| `plugin.install` | `({ id, kind: 'file'\|'npm'\|'github'\|'url', source, description })` | `plugin.install` | 安装插件（.dlient 路径 / npm / GitHub Release / URL）。参数全必填；宿主先弹**用户确认框**再安装，含 preInstall 依赖深度安装。worker scope、`dangerous` |
| `plugin.setActive` | `(pluginId \| null)` | `plugin.setActive` | 设置内容区活动插件（null 清除） |
| `plugin.dev.selectDirectory` | `()` | `plugin.dev` 组 | 目录选择器（仓库/dev 流程） |
| `plugin.dev.getDirInfo` | `(pluginId)` | `plugin.dev` 组 | 解析 dev 插件目录 |
| `plugin.dev.sync` | `(entries)` | `plugin.dev` 组 | 上报 dev 插件清单 |
| `plugin.dev.readLogs` | `(pluginId, { offset?, maxBytes? })` | `plugin.dev` 组 | 读取目标插件日志尾部 |
| `plugin.dev.clearLogs` | `(pluginId)` | `plugin.dev` 组 | 清空目标插件日志 |
| `plugin.dev.startDevWorker` / `stopDevWorker` | `(pluginId)` | `plugin.dev` 组 | 手动启停 dev 实例 worker |
| `plugin.dev.startWatcher` / `stopWatcher` | `(pluginId)` | `plugin.dev` 组 | 启停热重载 watcher |
| `plugin.dev.isPortReady` | `(pluginId)` | `plugin.dev` 组 | dev 实例 worker 端口就绪？ |
| `plugin.logs.subscribe` | `(pluginId)` | `plugin.logs` 组 | 订阅插件实时日志 → `{ subId }` |
| `plugin.logs.unsubscribe` | `(pluginId, subId)` | `plugin.logs` 组 | 退订 |

示例：

```ts
const cfg = await rpc.plugin.invoke('plugin-auth', 'plugin-auth.getConfig')   // == plugin.invoke
```

## 9. Webview

在 UI 中通过渲染 **`@dlient-open/ui`** **的** **`Webview`** **组件**来插入 webview（不要手动创建视图，详见 `references/ui.md` §2.1）。插入后有两种方式控制显示 / 隐藏：

- **宿主级显示 / 隐藏（多视图 / 编排，如顶部 tab 切换）** —— 调用以下两个方法（权限 `webview.create`）：

| 方法                            | 参数（类型）               | 权限               | 用途                                    |
| ----------------------------- | -------------------- | ---------------- | ------------------------------------- |
| `webview.showWebviewByPlugin` | `(views?: string[])` | `webview.create` | 显示本插件视图（传列表时精确恢复其中缓存的 `viewId`）       |
| `webview.hideWebviewByPlugin` | `()`                 | `webview.create` | 隐藏本插件视图 → 返回被隐藏的 `viewId` 列表，供切回时精确恢复 |

- **组件级** —— 给 `Webview` 组件传 `visible` 属性（`<Webview src={url} visible={activeTab === id} />`）；组件会自行同步到主进程。

想保留页面状态就保持视图挂载并切换 `visible`；只有想销毁视图才卸载。需要宿主级精确恢复时，从 `Webview` 的 `onViewReady` 记下 `viewId`。

## 10. Worker 侧便捷 API（WorkerRpc）

| API                                                             | 说明                                                |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `rpc.registerHandler(method, handler)`                          | 暴露可调用方法（配合 `manifest.expose`）                     |
| `rpc.registerStreamHandler(method, handler)`                    | 流式 handler（`ctx.emit` ×N，return 自动 `stream-done`） |
| `rpc.{module}.{method}(...args)` | 调用宿主能力的唯一方式（方法名 = host-api key，与 `manifest.permissions` 一致；`rpc.child.spawn/execFile` 为 SDK 封装，见 §4） |
| `rpc.plugin.invoke(pluginId, method, args)`                        | 跨插件（等价 `plugin.invoke`）                           |
| `rpc.push(event, data?)`                                        | 推送事件给插件渲染层视图（UI 经 `api.onEvent` 订阅）               |
| `rpc.registerSnapshotHandler / registerRestoreHandler`          | 热重载时的业务状态快照 / 恢复                                  |
| `rpc.effect(install)` / `rpc.onReady(cb)` / `rpc.onDispose(cb)` | 生命周期：可逆副作用 / 就绪 / 宿主停止前清理                         |
| `rpc.success(data?)` / `rpc.error(code, msg?)`                  | 构造响应信封（裸 return 自动归一）                             |
| `rpc.registerChildEvent / unregisterChildEvent`                 | 托管子进程事件分发                                         |
| `rpc.getPluginId()`                                             | 运行标识（正式 `<id>`；dev 实例 `<id>@dev`）                 |
| `rpc.log(level, message, data?)`                                | 上报日志（`info`/`warn`/`error`/`debug`）                              |

## 11. UI 端直连 host-api（渲染层）

插件 **UI** 可经 `useDlientApi()` 的 `api.{module}.{method}(...args)` 直接调用 host-api 的低风险子集
（纯 UI 插件可免写 worker 处理简单场景）。**UI 端可直连清单**（真源 = 主进程 `app/src/main/export.ts` 的
`UI_OPEN_METHODS`，经 `@dlient-open/api-bridge` 透出）见 `references/ui-api.md`；开放清单之外一律经本插件 worker 用 `rpc.{module}.{method}` 调用。

完整成员与类型见 `worker.md` §3。worker 是纯 Node，没有 `useEffect`；订阅/退订清理在 UI 侧（`useEffect` + `api.onEvent`）。
