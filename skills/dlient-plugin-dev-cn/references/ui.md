# UI 端编写说明

UI 是宿主渲染层经 SystemJS 加载的 React 包。没有 HTML 流程：宿主注入入口、链入你的 CSS，并在自己的布局内渲染你的默认导出。

## 1. 构建模型

- 配置预设：`@dlient-open/plugin-sdk/vite-config` 的 `createPluginViteConfig`。
- `vite build` → **System.register** 输出 → `dist/remoteEntry.js`。
- React 与 `@dlient-open/*` 外部化：宿主 SystemJS import map 解析为**共享单实例**。
- CSS 单独成文件，经 `dlientOpen://plugin/<插件id>/dist/<style>.css?v=<ts>` 注入（带版本戳）。CSS 内相对 `url()` 按 CSS 文件位置解析。
- 热重载是产物级：`npm run dev:watch` 写 `dist`；重开 / 重载宿主后生效（无 dev server 端口）。

## 2. 使用共享组件——`@dlient-open/ui`（shadcn 风格）

从 **`@dlient-open/ui`** 引入组件。它 re-export 一套 **shadcn/ui 风格组件**（radix 原语 + tailwind 变量，前缀 `dui:`），并兼容旧 `theme` 写法（`theme="primary"` 自动映射到 shadcn `variant`）。这些组件随宿主主题与共享样式渲染，**不要重复造轮子、不要自绘 UI**。

```tsx
import { Button, Input, Card, Dialog, Tabs, Select, Badge, toast } from '@dlient-open/ui'
```

`@dlient-open/ui` 常用组件（均 shadcn 风格，props 对齐标准 shadcn）：

| 类别 | 组件 |
| --- | --- |
| 基础 | `Button` `Input` `Textarea` `Checkbox` `RadioGroup` `Select` `Switch` `Slider` `Badge` `Label` `Kbd` |
| 数据展示 | `Table` `Tabs` `Card` `Avatar` `Skeleton` `Progress` `Separator` `Accordion` `Tooltip` `Popover` `HoverCard` |
| 反馈 | `Dialog` / `AlertDialog` `Sheet` `Drawer` `DropdownMenu` `ContextMenu` `Menubar` `Command` `Alert` `toast`/`Toaster` `MessagePlugin` |
| 布局与表单 | `Sidebar` `Resizable` `ScrollArea` `InputOtp` `ToggleGroup` `Pagination` `Breadcrumb` `Calendar` `Carousel` |
| 图标 | `Icon`（name 兼容）+ **lucide-react** 全部图标（re-export 常用具名） |
| dlient 专属 | `PluginView` `PluginIcon` `PluginErrorBoundary` `Webview` `LogViewer` `modal`/`createDialog` `useDlientApi` `useDientStore` `useDientEvent` |

- **旧 `theme` 兼容**：`<Button theme="primary">` 自动映射 shadcn `variant`；也可直接用 `variant="default" | "destructive" | "outline" | "secondary" | "ghost" | "link"`，`size="sm" | "lg" | "icon"`。
- **图标用 lucide**，不要自绘 SVG：
  ```tsx
  import { Icon } from '@dlient-open/ui'      // 兼容写法 <Icon name="code" size={48} />
  import { CodeIcon, SearchIcon, UploadIcon } from '@dlient-open/ui'   // 具名（lucide）
  ```
- **插件图标**（启动器网格中的 manifest 图标）用专属 `PluginIcon`：
  ```tsx
  import { PluginIcon } from '@dlient-open/ui'
  <PluginIcon pluginId="my-plugin" />
  ```
- 展示其它插件 UI 用 `PluginView`（目标须有 UI）：
  ```tsx
  <PluginView pluginId="plugin-auth" />
  ```
- 轻提示用 `toast`（sonner，宿主根已挂 `<Toaster />`）或旧 API `MessagePlugin`；反馈弹框优先 `modal` / `createDialog`（共享、随主题），不要手写遮罩层。

### 2.1 `Webview` —— 内嵌网页

把远程页面以主进程 `WebContentsView` 层叠在宿主窗口之上（真正的浏览器视图，不是 iframe）。需在 `manifest.permissions` 声明 `webview.create`（`webContents` 调用另需 `webview.navigate`）。

```tsx
import { useRef } from 'react'
import { Webview, type WebviewHandle } from '@dlient-open/ui'

export default function App() {
  const ref = useRef<WebviewHandle>(null)

  return (
    <div style={{ height: '100%' }}>
      <Webview
        ref={ref}
        src="https://example.com"
        onViewReady={(viewId) => console.log('view ready', viewId)}
        onDidFinishLoad={() => console.log('loaded')}
        onDidFailLoad={(code, desc) => console.error('load failed', code, desc)}
      />
    </div>
  )
}
```

Props：`src`（必填）· `webPreferences?`（仅白名单字段生效）· `visible?`（默认 true）· `onViewReady(viewId)` · `onDidFinishLoad` · `onDidFailLoad` · `onPageTitleUpdated`。
Handle：`ref.current.webContents.call(method, args)` 执行白名单 webContents 方法。

**tab 切换时的显示 / 隐藏。** `WebContentsView` 是系统级窗口，CSS `display:none` **不会**真正隐藏它——必须显式切换可见性：

```tsx
const [active, setActive] = useState('pageA')
// 只在其 tab 激活时渲染：
{active === 'web' && (
  <div style={{ width: '100%', height: '100%' }}>
    <Webview src="https://example.com" />
  </div>
)}
```

两种协同机制（都经主进程视图管理器）：

- **组件级**：对常驻挂载的 `Webview` 传 `visible={activeTab === id}`，组件会同步到主进程（`webview.setVisible`）。容器 0×0（隐藏中）跳过 bounds 更新，避免恢复时页面重载。
- **宿主级精确恢复（多视图 / tab 编排）**：从 `onViewReady` 记下 `viewId`；隐藏时调用宿主 hide-for-plugin，切回时把缓存的 view id 传回做**精确恢复**（`webview.showWebviewByPlugin` / `webview.hideWebviewByPlugin`，权限 `webview.create`）。

想保留页面状态就保持 `Webview` 挂载并切换 `visible`；只有想销毁视图时才卸载（卸载会自动 destroy）。

### 2.2 `LogViewer` —— 插件日志视图

展示插件自有日志（`plugin-data/<插件id>/logs/main.log`，JSONL），支持实时流式、下载、清空。**查看自己的日志零配置**：

```tsx
import { LogViewer } from '@dlient-open/ui'

export default function SettingsView() {
  return <LogViewer height={320} />   // 本插件日志：历史 + 实时 + 下载/清空
}
```

Props：`history?: number`（最新 N 条，≤200）· `reader?`（自定义读取源）· `subscribe?`（自定义实时订阅）· `event?` · `filterId?`（只追加该插件的推送）· `onDownload?` / `onClear?`（自定义动作）· `height?`（默认 480）· `className?`。

**跨插件查看**：传自定义 `reader`/`subscribe`（跨插件读取权限由你自己的通道负责）+ `filterId` 限定推送流：

```tsx
// readTargetLogs / subscribeTargetLogs 来自你 worker 的自定义方法（api.request 走自己的跨插件权限通道）；
// 查看其它插件日志不能依赖默认的“读自己”实现。
<LogViewer
  filterId={targetPluginId}
  reader={readTargetLogs}
  subscribe={subscribeTargetLogs}
/>
```

### 2.3 `modal` —— 命令式反馈弹框

`modal` 是共享、随主题、支持 i18n 的反馈 API。**优先使用 modal，而不是直接裸 `Dialog`**：变体已定义图标 + 按钮主题、确认自动 loading、`onConfirm` 返回 `false` 保持弹框、弹框随语言切换、支持原地 `update`。仅当 modal 无法表达你的布局时才回退 `Dialog`（见 2.3.3）。

**2.3.1 反馈变体**

```tsx
import { modal } from '@dlient-open/ui'

// 简单提示：按钮文案走变体预设
modal.info({ title: '提示', description: '已保存' })
modal.success({ title: '完成' })
modal.warn({ title: '警告', description: '…' })
modal.error({ title: '错误', description: '…' })

// confirm：可传异步 handler（自动 loading）
modal.confirm({
  title: '删除该项？',
  description: '该操作不可撤销。',
  confirmBtn: '删除',                       // string → 自定义文案；ReactNode → 完全自定义
  cancelBtn: null,                            // 隐藏取消按钮
  onConfirm: async (ctx) => {
    await doDelete()
    // 正常 resolve → 关闭；return false → 保持弹框
  },
  onCancel: () => { /* 可选；return false 保持打开 */ },
  onClose: () => { /* 任意关闭途径 */ },
  api,                                        // 传入 useDlientApi() 结果，弹框内 useI18n/useDlientApi 可用
})

// 危险默认：红色确认主题
modal.delete({ title: '移除', description: '…' })

// 同步（await）形式：确认 → true，取消/关闭 → false
const ok = await modal.sync.confirm('删除该项？', '该操作不可撤销。')
if (ok) await doDelete()
```

`ModalOptions`：`icon?`（`null` 隐藏图标）· `title?` / `description?`（ReactNode）· `confirmBtn` / `cancelBtn`（`string` 文案 / `ReactNode` / `null` 隐藏）· `closeBtn`（`boolean | ReactNode`）· `footer?`（完全替代按钮区）· `onConfirm(ctx)` / `onCancel(ctx)`（返回 `false` 阻止关闭；返回 Promise 自动挂确认按钮 loading）· `onClose()` · `width`（默认 420）· `closeOnOverlayClick` / `closeOnEscKeydown`（默认 false）· `className` / `zIndex` · `api?`（`useDlientApi()` 的 PluginApi）。

返回实例 `DuiModalInstance`：`.close()`（幂等）· `.update(patch)`（就地更新标题/描述/按钮）——适合进度或异步步骤后改按钮。

**2.3.2 `modal.dialog` / `createDialog` —— 自定义布局**

内容需要任意布局（表单、编辑器）时：`modal.dialog`（等价 `createDialog`）渲染**顶部锚定**弹框，内容区零 padding——`header` / `body` / `footer` 全自定义。

```tsx
const ins = modal.dialog({
  header: <h2>编辑配置</h2>,
  body: <MyForm api={api} onSubmit={submit} />,   // 无默认按钮
  footer: (
    <div>
      <Button onClick={() => ins.close()}>取消</Button>
      <Button theme="primary" onClick={submit}>保存</Button>
    </div>
  ),
  width: 640,
  api,                                            // PluginApi → body 内 context 可用
})

// 任意位置 update / close
ins.update({ header: <h2>保存中…</h2> })
ins.close()
```

`DialogOptions`：`header?` / `body?`/`children?`（零 padding）/ `footer?` · `closeBtn` · `width`（默认 800）· `height?`（默认最大 = 视口 2/3，超长内容区滚动）· `top?`（默认 0，吸顶）/ `placement: 'top' | 'center'` · `closeOnOverlayClick` / `closeOnEscKeydown` / `showOverlay` / `destroyOnClose` / `draggable` · `attach` · `className`/`dialogClassName`/`style`/`zIndex` · `api?` · `onClose` / `onOpened` / `onClosed`。

**2.3.3 何时才回退 `Dialog` / `AlertDialog`**

只有 modal 无法满足（很少见）时才用：例如 modal 未暴露的完全自定义能力。此时从 `@dlient-open/ui` 引 `Dialog` / `AlertDialog`，并遵守共享约定（随主题、内容区 `max-width:100%; overflow:hidden`、暗色滚动条保持暗色）。评审中以优先 modal 为原则。

## 3. 状态共享（`useDientStore`）与事件（`useDientEvent`）

渲染层状态共享与事件传递走 **`@dlient-open/ui`** 的 store / event 模块。身份（pluginId）由宿主注入，**不可伪造**；弹窗隔离根经 `modal` 的 `api` 传入后 context 仍可用。

### 3.1 Store —— 三层命名空间

```tsx
import { useDientStore, useStoreValue } from '@dlient-open/ui'

const store = useDientStore()

// 私有（本插件）
store.get('notes')            // T | undefined
store.set('notes', notes)
store.watch('notes', (prev, next, key) => {})

// 组织（同组织插件共享；无组织 → org 层禁用）
store.org.get('shared-key')
store.org.set('shared-key', value)
store.org.watch('shared-key', (prev, next, key) => {})

// 全局（按写入者分区；'@host' 宿主专用，get/watch 缺省写入者 = '@host'）
store.global.get('theme')                     // 读宿主发布的数据
store.global.get('theme', 'other-plugin')     // 读指定写入者
store.global.set('theme', 'dark')             // 写入者 = 自己
store.global.watch('theme', (prev, next, key) => {}, '@host')
```

- key 支持点分多层级：`watch('aaa.bbb')` 能收到 `aaa.bbb.ccc` 的变化；回调携带 `actualKey`。
- **响应式读取**：`useStoreValue(key, scope?, writerId?)`（`scope`：`'self'` 缺省 / `'org'` / `'global'`；`writerId` 仅 global 用，缺省 `'@host'`），仅目标 key 变化时重渲染：

```tsx
const theme = useStoreValue('theme', 'global')        // 读宿主 '@host' 的 theme
const myCount = useStoreValue('count')                // 读本插件私有
```

- 宿主写全局：`setHostGlobal(key, value)`（仅宿主渲染层；插件侧 `store.global.get` 缺省即读到）。
- 权限：private 仅自己、org 同组织、global 公开读（知道写入者 id 即可）；`global.set` 恒写自己、`@host` 仅宿主。

### 3.2 Event —— 三层命名空间（无状态广播）

```tsx
import { useDientEvent } from '@dlient-open/ui'

const event = useDientEvent()

// 本插件：emit / on / once
event.emit('data-changed', payload)
event.on('data-changed', (payload, meta) => {})        // 返回退订函数
event.once('ready', (payload, meta) => {})

// 组织：同组织插件可收（无组织 → 禁用）
event.org.emit('member-updated', data)
event.org.on('member-updated', (payload, meta) => {})

// 全局：所有插件可收；监听可按发布者过滤（插件 id / '@host'）
event.global.emit('app-theme', 'dark')
event.global.on('app-theme', (payload, meta) => {}, ['@host'])          // 只收宿主
event.global.on('app-theme', (payload, meta) => {}, ['@host', 'plugin-a']) // 宿主 + 插件A
event.global.on('app-theme', (payload, meta) => {})                       // 全部发布者
```

- 回调 `(payload, meta)`，`meta`：`{ name, publisher, publisherOrg?, ts }`。
- 无 replay：`on` 注册晚于 `emit` 收不到；`once` 触发一次即注销。
- 宿主发全局事件：`emitHostEvent(name, payload)`（仅宿主渲染层；插件侧 `event.global.on(name, cb, ['@host'])` 可收）。

## 4. 访问自己的 worker

```tsx
import { useDlientApi, isApiOk } from '@dlient-open/ui'

const api = useDlientApi()                       // 绑定本插件视图
const res = await api.request<string>('my-plugin.greet', ['world'])
if (isApiOk(res)) console.log(res.data)          // { ok, data, code } 信封
const off = api.onEvent('my-event', (data) => console.log(data))   // 返回退订函数
```

## 5. 国际化

```ts
// src/renderer/i18n.ts
import { addResourceBundle } from '@dlient-open/i18n'
addResourceBundle('my-plugin', {
  'zh-CN': { hello: '你好', btn: { save: '保存' } },
  'en-US': { hello: 'Hello', btn: { save: 'Save' } },
})
```

```tsx
// App.tsx
import './i18n'
import { useI18n } from '@dlient-open/i18n'
const { t } = useI18n()          // t('my-plugin.btn.save')；仅 {{name}} 插值
```

- 字符串值只替换 `{{name}}`；需要逻辑用函数式消息：`key: ({ name }) => …`。
- 宿主/worker 的错误码在本侧本地化——不要直接展示裸码或 worker 硬编码文案。

## 6. 完整示例

`src/renderer/App.tsx`（一个笔记插件的 UI，含 store 共享）：

```tsx
import { useEffect, useState } from 'react'
import { Button, Input, Card, Badge, Empty, toast, useDlientApi, useDientStore, useStoreValue, isApiOk } from '@dlient-open/ui'
import { useI18n } from '@dlient-open/i18n'
import './i18n'
import './styles.css'

const NS = 'my-plugin'

interface Note { id: number; text: string; ts: number }

export default function App() {
  const api = useDlientApi()
  const store = useDientStore()
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [busy, setBusy] = useState(false)
  const globalCount = useStoreValue('note-count', 'global')   // 读宿主 '@host' 计数

  const reload = async () => {
    const res = await api.request<Note[]>('my-plugin.listNotes')
    if (isApiOk(res)) setNotes(Array.isArray(res.data) ? res.data : [])
  }

  const save = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const res = await api.request('my-plugin.saveNote', [text.trim()])
      if (isApiOk(res)) {
        setText('')
        store.set('note-count', notes.length + 1)          // 私有共享
        await reload()
        toast.success(t(`${NS}.saved`))
      }
    } finally { setBusy(false) }
  }

  useEffect(() => {
    void reload()
    return api.onEvent('my-plugin.notes-changed', () => void reload())  // 卸载时退订
  }, [api])

  return (
    <div className="app-root">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
        <Input value={text} placeholder={t(`${NS}.placeholder`)} onChange={(e) => setText(e.target.value)} />
        <Button theme="primary" disabled={busy} onClick={save}>{t(`${NS}.save`)}</Button>
      </div>

      {notes.length === 0 ? (
        <Empty description={t(`${NS}.empty`)} />
      ) : (
        <Card>
          {notes.map((n) => (
            <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span>{n.text}</span>
              <Badge variant="secondary">{new Date(n.ts).toLocaleString()}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
```

## 7. 主题与样式

- **CSS 自动作用域化**：插件自身 `.css` 由构建预设改写为 `[data-plugin="<插件id>"] :where(...)`，只作用于本插件子树及其弹层（Portal 默认落 body 级同属性容器，Dialog/Popover/Select/Tooltip 等弹层样式自动生效）；宿主弹框 / `MessagePlugin` 不受影响。`:global(...)` 可显式逃逸，详见 `docs/specs/plugin-css-scope.md`。
- 主题记录在 `document.documentElement`（`dark` class；`localStorage['dlient-theme']`）。
- shadcn 组件自动跟随主题（`dui:` 前缀的 tailwind 变量：`--background` / `--foreground` / `--primary` / `--destructive` / `--muted` / `--border` / `--radius` …）。自定义配色用两套 CSS 变量：
  ```css
  :root { --app-bg: #fff; --app-fg: #222; }
  .dark { --app-bg: #1b1b1f; --app-fg: #ededf0; }
  ```
- 暗色文字亮度建议 ≥ `#8A8A96`；**暗色滚动条保持暗色**（不要用浅色覆盖宿主暗色 `::-webkit-scrollbar`）。
- Dialog 内容区需 `max-width: 100%; overflow: hidden;`。
- 优先 lucide 图标 / `PluginIcon`，颜色自动随主题。

## 8. Worker/UI 通信模式

| 模式 | 做法 |
| --- | --- |
| 调用 worker 方法 | UI `api.request('插件.方法', args)`；worker `registerHandler` |
| worker → UI 事件 | worker 推送事件；UI `api.onEvent(name, cb)`（卸载退订） |
| 渲染层 → 渲染层（同插件） | `useDientStore()` 私有 store / `useDientEvent()` self 事件 |
| 渲染层 → 渲染层（跨插件/组织/宿主） | `useDientStore()` 的 `org`/`global` 或 `useDientEvent()` 的 `org`/`global`（global 可按发布者过滤） |
| 宿主 → 渲染层广播 | `app.notify({ event, receiver, data })`（主进程广播）/ `setHostGlobal` / `emitHostEvent`（宿主渲染层） |
| 跨插件视图 | `PluginView` |
| 长进度 | worker 流式推事件；UI 订阅刷新 |

## 9. 日志

UI 侧日志与 worker 写入同一 JSONL 文件（`USER_DATA/plugin-data/<插件id>/logs/main.log`），以 `source` 字段区分来源。直接读该文件或经日志 host-api 拉取。
