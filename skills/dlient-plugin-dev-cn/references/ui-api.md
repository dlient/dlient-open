# UI 端直连 API 参考（ui-api）

> 插件 **UI**（渲染层）可经 `useDlientApi()` 的 `api.{module}.{method}(...args)` **直接调用**宿主 host-api 的**低风险子集**——纯 UI 插件（`type:'app'`、无 worker.js）可免写 worker 处理简单场景。
>
> - 开放清单真源 = 主进程 `app/src/main/export.ts` 的 **`UI_OPEN_METHODS`**（渲染层类型经 `@dlient-open/api-bridge` 的 `UI_HOST_API_PATHS` 透出，两者同源）；
> - UI 通道与 worker 通道共用同一 `executeHostApi`（scope 校验 + 声明校验 + fs 白名单）；不在 `UI_OPEN_METHODS` 内的方法即使 scope 为 `all` 也会被拒；
> - 白名单**之外**的 host-api 一律经本插件 worker 用 `rpc.{module}.{method}` 调用（UI 直连会被拒）；
> - **system scope API 不开放**（开源宿主无 system 插件；调用抛 `PERMISSION_DENIED`）。

## 1. 调用方式

```ts
import { useDlientApi } from '@dlient-open/api-bridge'
const api = useDlientApi()

const text = await api.fs.read('C:/tmp/a.txt')        // string
await api.app.data.write('settings.json', { theme: 'dark' })
const port = await api.net.fetch('https://api.example.com/data', { method: 'GET' }, '拉取数据')
```

方法签名 / 参数 / 返回与 worker 端 host-api 一致（见 host-api-reference.md）；UI 端经 `@dlient-open/api-bridge` 暴露同名方法。

## 2. 开放清单（UI 端可直连）

### 2.1 宿主信息 / 窗口状态（`app.*`）

| 方法 | 用途 |
| --- | --- |
| `app.getVersion()` / `app.getName()` | 宿主版本 / 应用名 |
| `app.getLocale()` / `app.getLocaleCountryCode()` / `app.getSystemLocale()` / `app.getPreferredSystemLanguages()` | 语言环境只读 |
| `app.getPath(key)` | 白名单路径（`userData` 返回插件隔离目录 `plugin-data/<id>`；`plugins` 返回安装根） |
| `app.isActive()` / `app.isHidden()` | 宿主激活 / 可见状态只读 |
| `app.notify({ event, receiver?, data? })` | 发 NOTIFY 总线事件（渲染层 receiver） |

### 2.2 插件数据 / 加解密（`app.data.*` / `app.crypt.*`）

| 方法 | 权限 | 用途 |
| --- | --- | --- |
| `app.data.read(file)` | `app.data` | 读 `<userData>/plugin-data/<id>/<file>.json`（per-plugin 隔离） |
| `app.data.write(file, json)` | `app.data` | 写隔离 JSON（原子） |
| `app.crypt.encrypt(plain)` / `app.crypt.decrypt(b64)` | `app.crypt` | 插件级 AES-256-GCM 加解密（master key 主进程私有，插件间隔离） |

### 2.3 语言 / 系统 / 网络（`i18n.*` / `system.*` / `net.*`）

| 方法 | 授权 | 用途 |
| --- | --- | --- |
| `i18n.getLocale()` | — | 宿主当前语言只读 |
| `system.getIdleState(threshold?)` | `system.getIdleState` | 系统空闲状态只读 |
| `net.isOnline()` | — | 网络连通只读 |
| `net.fetch(url, init?, description?)` | `net.request`（net-grants 域名白名单 + 首次确认） | 抓取完整响应；防 SSRF（禁内网/回环） |
| `net.request(options, description?)` | `net.request` | 底层请求 |

### 2.4 对话框（`dialog.*`）

| 方法 | 授权 | 用途 |
| --- | --- | --- |
| `dialog.showOpenDialog(permissions, options, description?)` | 申请的 `fs.*` | 系统选择器 + 授权所选路径 → `{ filePaths, granted }` |
| `dialog.showSaveDialog(options)` | — | 保存选择器 → `{ filePath }` + 保存会话写授权 |
| `dialog.showMessageBox(options)` | — | 原生消息框 |

### 2.5 通知（`notification.*`）

| 方法 | 授权 | 用途 |
| --- | --- | --- |
| `notification.isSupported()` | — | 系统通知可用性 |
| `notification.send(options)` | `notification.send`（或前缀组） | 发送 → 返回句柄 `{ id }`；`on("click"/"close"/"reply"/"action"/"failed"/"show", cb)`；`close()` |
| `notification.remove(id)` | `notification.remove` | 关闭本插件通知（owner 校验） |
| `notification.removeGroup()` | `notification.removeGroup` | 关闭本插件全部通知 |
| `notification.subscribe/unsubscribe({ id })` | 免声明（owner 校验） | 句柄事件订阅 / 退订 |

### 2.6 文件系统（`fs.*`）

| 方法 | 授权 | 用途 |
| --- | --- | --- |
| `fs.read(path)` / `fs.stat(path)` / `fs.listDir(path)` / `fs.watch(path)` / `fs.unwatch(id)` | **fs-grants 读白名单** | 读文件 / 状态 / 列目录 / 监听 / 停止监听 |
| `fs.mkdir(path)` / `fs.write(path, data)` / `fs.append(path, data)` / `fs.delete(path)` / `fs.copyDir(src, dest, exclude?)` / `fs.lock/unlock` / `fs.withLock` | **fs-grants 写白名单** | 写文件 / 目录操作（授权来源：manifest.fsDirs / `dialog.showOpenDialog` / `permission.request`） |

### 2.7 剪贴板（`clipboard.*`）

| 方法 | 授权 | 用途 |
| --- | --- | --- |
| `clipboard.read*`（readText / readHTML / readRTF / readBookmark / readFindText / readImage / readBuffer / read / has / availableFormats） | `clipboard.read` | 读剪贴板 |
| `clipboard.write*`（writeText / writeHTML / writeRTF / writeBookmark / writeFindText / writeBuffer / write / clear） | `clipboard.write` | 写 / 清空剪贴板 |

### 2.8 其它（`permission.*` / `log.*`）

| 方法 | 授权 | 用途 |
| --- | --- | --- |
| `permission.request(resources, description?)` | — | **资源授权申请入口**（批量申请 fs/net/spawn），handler 内弹框确认后写 grants |
| `log.write(level?, message?, data?)` | `log` | 写本插件日志（未声明 → `-2107` 拒绝并写插件日志） |

## 3. 不开放（UI 端不可直连）

- **system scope API**：`plugin.capabilities`、`permission.revoke`、`os.openExternal` 等 system scope 方法不向 UI 开放（开源宿主无 system 插件；调用即拒绝）；
- 其余白名单之外 host-api（`child.*`、`app.createNative*`、`app.window.*`、`screen.*`、`webview.*`、`plugin.invoke` 等）：一律经 worker 用 `rpc.{module}.{method}` 调用（`app/src/main/export.ts` 的 `UI_OPEN_METHODS` 为唯一真源）。
