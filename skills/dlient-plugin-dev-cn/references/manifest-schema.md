# Manifest 字段参考

Manifest 即插件 `package.json` 的 **`dlient`** 子对象。类型真源：`@dlient-open/plugin-sdk` 的 `PluginManifest`（`preInstall` 等宿主侧字段见下）。

## 1. 字段速查表

### 身份与展示

| 字段                                   | 类型              | 必填    | 默认           | 说明                                       |
| ------------------------------------ | --------------- | ----- | ------------ | ---------------------------------------- |
| `id`                                 | string          | 否\*   | 顶层 `name`    | 插件唯一 ID（小写字母/数字/连字符）                     |
| `version`                            | string          | 否\*   | 顶层 `version` | Semver                                   |
| `name`                               | `LocalizedText` | **是** | —            | 显示名；字符串或 `{ default, "zh-CN", "en-US" }` |
| `description`                        | `LocalizedText` | **是** | —            | 描述（同多语言形式）。必填。                          |
| `author` / `homepage` / `repository` | string          | 否     | —            | 元信息（`author` 可回退顶层）                      |

\* 实际建议必填；宿主缺失时回退顶层 `package.json` 字段。

### 形态与产物

| 字段           | 类型                                    | 默认                   | 说明                                                                                                                                                                                                     |
| ------------ | ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`       | `'app' \| 'full' \| 'worker' \| 'ui'` | `app`                | `app`（缺省）：独立应用，基座启动器直接打开页面；`full`：UI+worker；`worker`：仅 worker；`ui`：仅 UI。旧 `main` / `ui` 字段**已废弃**——形态由 `type` + 构建产物中是否存在 `dist/worker.js` 决定。                              |
| `dist`       | string                                | `dist`               | 相对插件根的产物目录。产物恒为**普通散列目录**（`remoteEntry.js` / `worker.js` / …）——没有 asar 打包、也没有 plugin.json 形态。                                                      |
| `workerMode` | `'shared' \| 'solo'`                  | `shared`             | `solo`：独占池（一插件一进程）。dev 插件（`source:'dev'`）未设池分组时强制 solo。                                                                                                                                          |

### 来源

| 字段          | 类型                 | 默认     | 说明                                                                                                   |
| ----------- | ------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| `source`    | `'local' \| 'dev'` | `local` | 开源版**无 `market`、无 `system=true` 插件**：本地导入 / 开发中。导入的插件一律强制 `source='local'`、`system=false`。 |
| `platforms` | `PluginPlatform[]` | 全平台    | 简单数组：**六个 OS.arch 组合**的子集：`win32.x64` `win32.arm64` `darwin.x64` `darwin.arm64` `linux.x64` `linux.arm64`。空 / 缺省 = 全平台。 |

### 图标

| 字段           | 类型     | 说明                                                      |
| ------------ | ------ | ------------------------------------------------------- |
| `icon`       | string | **必填**。相对路径（如 `assets/icon.svg` / `.png`），以 `<img>` 渲染。 |
| `search_api` | string | 预留搜索 API 标识                                             |

### 权限与资源

| 字段            | 类型                                                    | 说明                                                       |
| ------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `permissions` | `PluginPermission[]`                                  | 申请的宿主能力（见下表）                                             |
| `fsDirs`      | `{ read?: string[]; write?: string[] }`               | 目录声明（别名或绝对路径），读写分集；安装时确认                                 |
| `spawnCmds`   | `(string \| { cmd: string; argsPattern?: string })[]` | spawn 命令白名单。`string` = 仅命令（参数不限，注册时告警）；对象 = 命令 + 逐参数正则约束 |

**`fsDirs`** **目录别名**：`DOWNLOAD` `DOCUMENT` `DESKTOP` `PICTURE` `RECENT`（仅 Win/mac）`MUSIC` `VIDEO` `HOME` `TEMP` `DATA`（=`USER_DATA/plugin-data/<id>`，默认授予）`PLUGINS`（=`USER_DATA/plugins`）。宿主内部目录不开放给插件。

### 运行与原生

| 字段              | 类型                                                                   | 说明                                                                  |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `preInstall`    | `Record<string, string>`                                             | **安装期依赖**：`{ <插件id>: "0.5.1" \| "https://github.com/owner/repo" \| "https://….dlient" }`。导入/安装时宿主逐项深度安装（npm semver / GitHub 最新 Release 的 `*.dlient` / `.dlient` 直链）；这些键并入运行时「就绪」依赖闭包（缺失即未就绪），但**不会隐式放开跨插件调用**——调用仍需 `dependencies` 白名单。 |
| `dependencies` | `Record<string, string[]>` / `string[]`                              | 跨插件调用声明：键为依赖**插件 id**（值 = 本插件要调用的目标 expose 方法；也接受纯 id 数组）。`plugin.invoke` 授权的前置。 |
| `nodeVersion`  | string                                                               | 最低 Node 版本（`"22"`、`">=22"`、`"22.11"`）。触发宿主就绪门控；不满足时宿主自动安装其内置托管 Node。`nodejs` 视为运行时占位，而非缺失插件。 |
| `native`       | boolean                                                              | `true`：`.node` 随 dist 内置（须同时声明 `platforms`）。与 `nativeModules` 互斥。   |
| `nativeModules`| `{ dependencies?: Record<string,string>; useBundledNode?: boolean }` | 原生模块用户侧安装（npm），由 native-host Node 子进程加载。`useBundledNode` 默认 `true`。 |
| `engines`      | `{ dlient?: string; electron?: string }`                             | 宿主 / Electron 版本门槛                                                  |

### 跨插件 API

| 字段             | 类型                                                                                                  | 说明                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `expose`       | `Record<string, { description?: string; access?: string; paramsSchema?: Record<string, unknown> }>` | 其它插件可调用的方法（完整点分 key，如 `my-plugin.greet`）。`access` 为访问表达式；`paramsSchema` 为可选的参数 JSON Schema 描述（仅供文档/表单生成，宿主不在运行时校验）。 |

**`expose`** **access 取值**（`|` = 或、`&` = 且）：
`private`（仅自己）· `default`（宿主 + 自己）· `system`（system 插件——开源版**无 system 插件**，实际仅宿主内部）· `public`（任意插件）· `install-confirm`（安装时用户确认）· `runtime-confirm`（调用时用户三选确认：拒绝 / 仅本次允许 / 始终允许）。confirm 档须有有效授权记录才放行；被调用方可另暴露 `grant` 方法做程序化授权（返回 `allow` / `ask` / `deny` 三态）。

**expose 策略**——尽量少暴露：仅当其它插件确实必须调用本插件，或用户明确要求时才添加 `expose` 条目。插件能暴露方法的**唯一条件**是它真的带 worker —— 即构建产物包含 `dist/worker.js`；manifest 的 `type` 与能否暴露无关（带 `dist/worker.js` 的 `app` / `ui` 插件**也能**暴露，注册 handler 的正是 worker；而没有 `dist/worker.js` 的插件不能暴露 —— 没有任何东西能承载该调用 → 宿主以 `WORKER_NOT_RUNNING`、`-2102` 拒绝）。有 worker 的插件（`full` / `worker`，或任何带 `dist/worker.js` 的插件）通常才声明 `expose`，且每个暴露的方法都需要 worker 中对应的 `rpc.registerHandler('<pluginId>.<method>', …)`。

**保留的 `grant` key**——`expose` 可包含一个字面名为 `grant` 的条目，如 `"grant": { "description": "…", "access": "default" }`。宿主调用被调用方 worker 的 `grant` handler 做授权；它返回 `allow`（对该调用方 + 方法永久授权）/ `ask`（用户三选确认：拒绝 / 仅本次允许 / 始终允许）/ `deny`（拒绝）。推荐默认 **`ask`**；对涉及隐私、密码、密钥或 token 的一律返回 **`deny`**；仅对明确无害的方法用 `allow`。未暴露 `grant` 时，未授权的跨插件调用以 `ACCESS_DENIED` 失败。

**密钥**——密码 / 密钥 / token 经 `app.crypt` 加密存储（权限 `app.crypt`）；绝不把明文密钥写入 `app.data`。

## 2. `permissions` — 怎么声明

声明值 = 你要用的 host-api **key** 或其模块前缀组。开源模板示例：`app.crypt`、`app.data`、`app.event`、`app.getPath`、`app.notify`、`dialog.showOpenDialog`、`dialog.showSaveDialog`、`log`、`permission.request`、`plugin.invoke`，以及 `fs.read`、`child.spawn`、`nodejs.resolveRuntime` 等。每次 host-api 调用受两道门禁约束：

1. **scope（调用通道门禁）** —— `all`（任意通道）/ `worker`（worker 可达；UI 直连还需白名单条目）/ `ui` / `system`（仅宿主内部——开源版无 system 插件，**插件不可用**）。
2. **level（安装风险标签）** —— `default`（灰点）/ `warn`（橙点）/ `dangerous`（红点）；导入确认框按此显示色点。

常见分组（逐方法清单见 `references/host-api-reference.md`）：

| 区域 | 声明值（示例） | 说明 |
| --- | --- | --- |
| 文件 | `fs.read` `fs.write` `fs.delete` `fs.listDir` `fs.watch` | `fs.stat` → `fs.read`；`fs.append`、`fs.copyDir`、`fs.lock`、`fs.unlock`、`fs.withLock`、`fs.mkdir` → `fs.write`；`fs.unwatch` → `fs.watch`（部分宿主方法复用 `fs.read`/`fs.write`——没有可声明的 `fs.stat` 权限） |
| App | `app.data` `app.crypt` `app.window` `app.menu` `app.shortcut.register` `app.setAutoLaunch` `app.event` | 组权限覆盖 `app.data.*` / `app.crypt.*` / `app.window.*` 等。`app.getPath`、`app.notify` 没有组前缀，同样必须以精确 key 声明（无需资源授权，但声明是必须的） |
| 剪贴板 | `clipboard.read` `clipboard.write` | 全部 `clipboard.*` |
| 对话框 | `dialog.showOpenDialog` `dialog.showSaveDialog` | 对所选路径追加所申请的 `fs.*` 授权 |
| 子进程 | `child.spawn` | SDK `child.spawn` / `child.execFile` 封装 |
| Webview | （无） | `@dlient-open/ui` 的 `<Webview>` **无需声明权限**：使用 `PluginView` 注入的绑定本视图客户端（沙箱与 webPreferences / 方法 / 事件白名单由宿主保留） |
| Node.js | `nodejs.checkLocal` `nodejs.checkBundled` `nodejs.resolveRuntime` `nodejs.install` | 内置运行时，不是插件 |
| 插件 | `plugin.install` `plugin.setActive` | `plugin.invoke` / `plugin.requestGrant` 为基础能力（免声明；按 `dependencies` + 目标 `expose` 校验） |
| 通知 | `notification.send` `notification.remove` `notification.removeGroup` | 无「免权限」：各自需要以精确 key 声明（或用 `notification` 组前缀）。仅 `notification.subscribe` / `notification.unsubscribe` 豁免（句柄归属校验，由句柄 `on()` 内部调用） |
| 日志 | `log` | `log.write` 组前缀 |

## 3. 完整示例

```jsonc
// package.json
{
  "name": "my-plugin",
  "version": "1.2.0",
  "type": "module",
  "dlient": {
    "id": "my-plugin",
    "version": "1.2.0",
    "type": "full",                       // UI + worker（缺省为 app）
    "name": { "default": "My Plugin", "zh-CN": "我的插件", "en-US": "My Plugin" },
    "description": { "default": "…", "zh-CN": "…" },   // 必填
    "icon": "assets/icon.svg",                        // 必填
    "source": "local",
    "workerMode": "solo",                 // 含敏感数据 → solo
    "platforms": ["win32.x64", "win32.arm64", "darwin.x64", "darwin.arm64", "linux.x64", "linux.arm64"],
    "permissions": ["fs.read", "fs.write", "child.spawn", "app.data", "app.crypt", "log"],
    "fsDirs": { "read": ["DOCUMENT"], "write": ["DATA"] },
    "spawnCmds": [                        // 解释器建议用对象规则（约束参数）
      "git",
      { "cmd": "python3", "argsPattern": "[-]c .*|\\.py|--version" }
    ],
    "nodeVersion": ">=22",                // 就绪门控；不满足时宿主自动装内置运行时
    "preInstall": {                       // 安装期依赖 → 导入时深度安装（npm / github / URL）
      "plugin-helper": "0.5.1",
      "plugin-tools": "https://github.com/someowner/sometools"
    },
    "expose": {
      "my-plugin.greet": {
        "description": "Say hello",
        "access": "public",
        "paramsSchema": { "type": "object", "properties": { "name": { "type": "string" } } }
      }
    },
    "dependencies": { "plugin-auth": ["plugin-auth.getConfig"] }
  }
}
```
