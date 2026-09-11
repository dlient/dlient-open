# 开发规范

dlient 插件开发的编码规范。请与各参考指南一并遵守。

## 1. Worker 规范

### 1.1 沙箱边界

- worker 内**禁用 `node:fs` / `child_process` / `.node` / `worker_threads`**——一切走 `rpc.{module}.{method}`，进程权限模型已封禁其余。
- 文件**写入只进 `DATA`**（`USER_DATA/plugin-data/<插件id>`），经 `app.data.*` 或已授权的 `fs.*` 路径；绝不写宿主目录或其它插件数据。
- **统一走 SDK 封装**（`rpc.child.spawn` / `rpc.child.execFile`，返回 `ChildHandle`）；host-api v2 后 `child.register/child.killTree` 等内部键已不再导出，句柄 kill/stdin/事件走 `child-control`/`child-subscribe` 控制消息。

### 1.2 绝不同步阻塞

- **禁用同步阻塞**：`spawnSync`/`execFileSync`/同步文件 I/O 一律禁止——事件循环冻结时，宿主会重启你的 worker。
- 重活必须异步（`spawn`/`execFile`/`fs/promises`）；大文件解压等要异步化。
- CPU 密集插件建议 `workerMode: 'solo'`，避免卡顿同池邻居。

### 1.3 handler 注册

- 用 `rpc.registerHandler('<插件id>.<方法>', handler)` 注册（点分命名空间 = 插件 id）。
- 启动时**幂等**注册——热重载 / worker 重启会重跑 `dist/worker.js`。
- 每个对外可调方法都配 `manifest.dlient.expose` 守卫；跨插件调用在 `dependencies` 声明。

### 1.4 错误与本地化

- 抛结构化错误（`PluginError`，码段 `-3001..`）；预期失败不要抛裸字符串。
- worker 内**不要硬编码中文/英文用户文案**——返回错误码 / 本地化消息，UI 按 locale 解析（未知码回退英文 `message`）。

### 1.5 日志

- worker 用 `rpc.log.write(level, message, data?)`（info/warn/error/debug；manifest.permissions 声明 `log` 即可，无需 fs）。日志落 `plugin-data/<插件id>/logs/main.log`（JSONL，直接读文件或经日志 host-api 拉取）。
- 保持结构化：`rpc.log.write('info', '事件', { …data })`；避免 `console.log` 噪音。

### 1.6 子进程

- 只经 `rpc.child.spawn` / `rpc.child.execFile` spawn；拿到 `ChildHandle` 后挂 `onStdout/onStderr/onExit/onError`，用完 `kill()`（幂等）。
- 命令须在 `manifest.dlient.spawnCmds` 或运行时 `spawn-confirm` 覆盖内；解释器要用带 `argsPattern` 的对象规则，不要裸 string。
- 原生模块绝不进 worker——用 `native`/`nativeModules`（native-host）。

### 1.7 跨插件暴露与密钥

- **expose 策略**：非必要不添加 `dlient.expose` 条目（其它插件确实必须调用本插件，或用户要求时才加）。插件能暴露方法的**唯一条件**是它真的带 worker —— 即构建产物包含 `dist/worker.js`；manifest 的 `type` 与能否暴露无关（带 `dist/worker.js` 的 `app` / `ui` 插件**也能**暴露，注册 handler 的正是 worker；而没有 `dist/worker.js` 的插件不能暴露 —— 没有任何东西能承载该调用 → `WORKER_NOT_RUNNING`、`-2102`）。
- 每个暴露的方法都需要对应的 `rpc.registerHandler('<pluginId>.<method>', …)`。**尽量**同时暴露 `grant` handler（推荐而非强制）：`rpc.registerHandler('grant', …)` + 配套的 `expose.grant` 条目；优先 `ask`，对涉及隐私、密码、密钥或其它敏感信息的一律返回 `deny`，仅对明确无害的方法用 `allow`。
- **密钥**：密码 / 密钥 / token 用 `app.crypt` 加密（`rpc.app.crypt.encrypt` / `decrypt`，权限 `app.crypt`）**后再**存储（如存入 `app.data`，它是磁盘明文）；绝不在源码里硬编码，也绝不记录或返回明文。

## 2. UI 规范

### 2.1 使用共享组件——不重复造轮子

- 从 **`@dlient-open/ui`** 引入（shadcn 风格组件 + lucide 图标 re-export + dlient 专属组件）。不要手写 `Button/Input/Select/Dialog/…` 的替代品。
- 插件图标一律用 `PluginIcon`（禁止自己实现）；嵌入其它插件 UI 用 `PluginView`；视图包 `PluginErrorBoundary`。
- 反馈弹框用 `modal`/`createDialog` 或 `Dialog`/`AlertDialog`，不要自绘遮罩。
- **图标用 lucide**（`Icon` 或从 `@dlient-open/ui` 具名导入，**全量** lucide 图标都已 re-export）。能用 lucide 图标就不要自绘 SVG/mask 图标。
- 长任务视图包 `PluginErrorBoundary`，避免渲染层错误拖垮宿主。

### 2.2 访问宿主 / worker

- UI ↔ worker 只用 `useDlientApi`（`api.request` / `api.onEvent`），用 `isApiOk` 处理 `{ ok, data, code }` 信封。
- `api.onEvent` 在卸载时**必须退订**（`useEffect` cleanup），否则视图泄漏监听，热重载重复触发。

### 2.3 国际化

- 资源用 `addResourceBundle('<插件id>', { 'zh-CN': …, 'en-US': … })` 注册一次；消费用 `useI18n` → `t('<插件id>.key')`。
- 字符串值只支持 `{{name}}` 插值；需要逻辑用函数式消息。宿主/worker 错误码在本侧本地化。

### 2.4 样式与主题

- **CSS 已自动作用域化**（plugin-sdk 构建预设 PostCSS 前缀 `[data-plugin="<插件id>"] :where(...)`）：插件自身 `.css` 只作用于本插件视图子树与其弹层（Portal 落 body 级同属性容器），无需手写 `<插件id>-` 前缀类名；`:global(...)` 可显式逃逸，`html/body/:root/*` 指向插件根容器。详见 `docs/specs/plugin-css-scope.md`。
- **不要在自己的标记里写 `dui:*` 工具类**：共享的 `@dlient-open/ui` 样式表由该包自身源码预编译，只有它已经用到的工具类存在——其它 `dui:*` 类会静默失效。自己的布局用普通 CSS / `*.module.css`，视觉风格交给共享组件。
- 推荐局部样式用 `*.module.css`（vite CSS Modules，hash 类名）；普通 `.css` 由前缀作用域兜底。
- 用 `:root` / `.dark` CSS 变量跟随宿主主题；不要在暗色里用硬编码浅色。
- **暗色滚动条保持暗色**——不要用浅色覆盖宿主暗色 `::-webkit-scrollbar`。
- **Dialog 内容区：`max-width: 100%; overflow: hidden;`**——长内容不得撑破弹框或出现双滚动条。
- 暗色文字亮度 ≥ `#8A8A96` 保证可读。

### 2.5 文件组织

- 渲染层放在 `src/renderer/`（`App.tsx` 默认导出 = 视图、`i18n.ts`、`styles.css`、`env.d.ts`）。
- `App.tsx` 使用 `t()` 前先 `import './i18n'`。

## 3. 通用

- `manifest`：`type` 缺省 `app`——不同时显式声明；产物恒为普通 `dist/`（无 asar / plugin.json）；`description`/`icon` 必填。
- 源码改动后必须完整构建（`npm run build`），确保 `dist` 与源码同步后再交付/测试。
- 权限务必在 dev 实跑中端到端验证；逃生变量只临时使用，绝不进生产产物。
