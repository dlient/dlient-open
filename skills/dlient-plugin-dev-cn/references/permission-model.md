# 权限模型（沙箱 + 资源授权）

权威规范：`docs/specs/plugin-permission.md`。本文件为面向开发者的精简指南。

## 1. 进程级沙箱

在 worker 内不能用 `node:fs` / `node:child_process` / `worker_threads`，不能加载 `.node` addon，也不能同步阻塞——一切走 host-api。

- 文件写入、子进程与原生模块必须经宿主（`fs.*`、`child.*`）或 **native-host** 子进程（全权限官方 Node 进程，跑 `.node`）。
- 目前允许直接 `node:net` / `fetch`（临时策略；大量 npm 包直连）。宿主 `net.*` 授权仍是主路径，严格模式下会取代它。
- 仅开发期的逃生开关：`DLIENT_DISABLE_PERMISSION=1`（跳过进程级封禁）、`DLIENT_DISABLE_FS_ENFORCE=1`（跳过 fs 路径校验）。

### 进程池

- `workerMode: 'solo'` 或 `source: 'dev'`（未设 `#plugin` / `@org` 池分组）→ 独占池（一插件一进程）。
- 否则进共享池。**共享池 = 互信插件**（同进程共享 JS 堆）；含敏感数据的插件应用 `solo`。

### native-host

原生模块绝不跑在 worker 里，而是跑在宿主管理的全权限 Node 子进程：
- `native` → `.node` 随 dist 内置，按 Electron ABI rebuild，逐平台；
- `nativeModules` → 用户侧经 npm 安装（`dependencies`），由 native-host 解析加载。

宿主负责拉起并按 owner 跟踪、**崩溃后自动重启**；重启时在途 RPC 请求被 reject。

## 2. 两层授权

1. **方法权限** —— `manifest.permissions` 条目，每次 host-api 调用都会校验。
2. **资源白名单** —— 文件 / URL / 命令：

| 授权种类 | 含义 | 生命周期 |
| --- | --- | --- |
| `DATA` | `USER_DATA/plugin-data/<插件id>` | 恒授权 |
| `fsDirs` / `spawnCmds` | manifest 声明 | 安装时确认 |
| `fs-grants` / `net-grants` / `spawn-grants` | 用户选「始终允许」 | 持久、可撤销、加密落盘 |
| `session-grants` | 用户选「仅本次」 | 纯内存，宿主重启即失效 |
| `temp-grants` | 保存流程 | 30s TTL 兜底；命中提升为会话授权（另存为会话） |

## 3. 运行时确认（统一弹框）

插件首次触碰白名单外资源时，宿主在渲染层弹一个统一确认框：

| 弹框 | 触发 | 授予 |
| --- | --- | --- |
| `fs-access` | `dialog.showOpenDialog(permissions, options, description?)` | 所选路径的读写授权 |
| `net-access` | `net.fetch` / `net.request` 访问未授权 URL | URL/域名授权 |
| `spawn-confirm` | `child.spawn` / `child.execFile` 执行未声明命令 | 命令授权 |
| `runtime-confirm` | 跨插件方法 `access: 'runtime-confirm'` | 永久 / 会话授权（用户三选） |

每个弹框提供**作用域**：**始终允许**（持久）/ **仅本次**（会话）/ **拒绝**。作用域由用户决定，插件不可自选。

- `description` 参数自定义弹框文案。
- **批量**：`permission.request([{ type, resource, mode?, description? }, …])` 一次弹框列多项（全部 / 逐项 / 拒绝 + 作用域）。

### 跨插件调用授权（dependencies 前置 + 被调用方 grant）

跨插件调用（`plugin.invoke` / `rpc.plugin.invoke`）的授权链：

1. **dependencies 前置** —— 调用方须在 `manifest.dependencies` 声明目标方法（或目标插件 id）；已声明且目标 `access` 放行 → 直接调用；未声明且无授权记录 → 走下一步；
2. **被调用方 `grant`** —— 主进程特权调用被调用方的 `grant({ method, plugin_id, version, data? })`，返回三态：
   - `allow` → 写**永久授权**（expiresAt=null）放行；
   - `deny` → 拒绝（返回拒绝错误码，前端报错）；
   - `ask` → 用户三选确认框（拒绝 / 仅本次允许 / 始终允许）。
3. 被调用方**未暴露 `grant`**（expose 无 `grant` / 声明了但未实现）→ **拒绝调用**。
- 调用方也可主动预授权：`rpc.plugin.requestGrant(pluginId, method, data?)`。

## 4. 文件访问示例

```ts
// 1. 用户选文件并同意授权（一次完成）
const { filePaths, granted } = await rpc.dialog.showOpenDialog(['fs.read'], { properties: ['openFile'] }, '选择要导入的配置')

// 2. 经宿主读取（realpath 校验 + 白名单）
const content = await rpc.fs.read(filePaths[0])

// 保存：不弹确认（意图明确），授予保存作用域授权：
const { filePath } = await rpc.dialog.showSaveDialog()
await rpc.fs.write(filePath, data)   // 之后再次保存仍可用（会话级）
```

## 5. 路径规则与加固（摘要）

- 路径校验先 realpath 解析「最深已存在祖先」，拦截符号链接逃逸；授权与实际 I/O 用**同一解析后路径**。
- `fsDirs` 别名在插件启动时解析；当前系统不可用的别名（如 Linux 的 `RECENT`）记 warn，不静默降级。
- 授权文件损坏时改名 `<file>.corrupt-<时间戳>` 留证并记日志（不再静默清零）。
- 拒绝与撤销都写结构化 `security` 审计行。

## 6. spawn 命令规则

manifest `spawnCmds` 两种写法：

```jsonc
"spawnCmds": [
  "git",                                          // 仅命令，参数不限（兼容旧格式）
  { "cmd": "python3", "argsPattern": "[-]c .*" }  // 逐参数锚定正则
]
```

运行时判定三态：`allow`（放行）/ `nomatch`（走 `spawn-confirm`）/ `args-denied`（参数违约，硬拒绝 + 审计）。运行时授权某命令 = 授权该命令本身（参数不限——用户可见取舍）；确认弹框始终展示**完整命令行**。

## 7. 宿主事件推送

子进程的流与生命周期经控制面 child-event 推送，SDK 分发到 `ChildHandle` 回调（`onStdout/onStderr/onExit/onError`）。宿主 → 渲染层事件走 NOTIFY 总线（`app.notify`，receiver 定向）。

## 8. 密钥存储 — `app.crypt`

密码、密钥与 token 绝不能明文存储或处理：

- `app.crypt.encrypt(plain)` / `app.crypt.decrypt(ciphertext)` —— 为本插件加密/解密值；权限 `app.crypt`。worker 侧可达（`rpc.app.crypt.encrypt(...)`），UI 侧也可达（`api.crypt.encrypt(...)`，它在 UI host-api 白名单内）。
- `app.data.read` / `app.data.write` 是**磁盘上的明文隔离存储**，因此单靠它不够——写密钥前先加密，读回后再解密。
- **没有免权限的替代方案**：绝不在源码里硬编码密钥、密码或 token。
- 密钥**绝不**出现在日志或跨插件响应里。
