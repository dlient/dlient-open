/**
 * webview-manager.ts - 主进程 WebContentsView 管理器（webview 能力原语 + 白名单 + 事件转发）。
 *
 * 设计（见 docs/plugins/webview.md §7.4）：
 *  - 创建/更新/销毁由 webview 插件 worker 经 hostApi 调用，能力按插件授权
 *    （webview.create / webview.navigate），不硬编码 pluginId；
 *  - 归属（owner）+ 可见性对齐在主进程维护：create 记录归属，setActivePlugin 遍历对齐，
 *    worker 重启不丢失归属状态；
 *  - webPreferences 白名单（SAFE_PREFS）+ 强制安全项（sandbox/contextIsolation），
 *    忽略插件传入的危险字段；
 *  - webContents 方法白名单（SAFE_METHODS），其余（send/openDevTools 等）一律拒绝；
 *  - webContents 事件白名单（SAFE_EVENTS）→ 转发 webview 插件 worker（→ 前端组件）。
 */

import { BrowserWindow, WebContentsView } from 'electron'

/** 允许透传的 webPreferences 字段（其余忽略，安全项强制） */
const SAFE_PREFS = ['partition', 'userAgent']

/** webContents 方法白名单（导航 / 标题 / 缩放 / executeJavaScript 等） */
const SAFE_METHODS = new Set([
  'loadURL',
  'reload',
  'stop',
  'goBack',
  'goForward',
  'getURL',
  'getTitle',
  'executeJavaScript',
  'setZoomLevel',
  'getZoomLevel',
])

/** webContents 事件白名单（只读生命周期 / 导航事件，转发给 webview 插件） */
const SAFE_EVENTS = new Set([
  'did-finish-load',
  'did-fail-load',
  'did-start-loading',
  'did-stop-loading',
  'page-title-updated',
  'did-navigate',
  'did-navigate-in-page',
  'will-navigate',
])

interface WebviewEntry {
  id: string
  view: WebContentsView
  win: BrowserWindow
  /** 归属插件 id（null = 无归属，始终可见）；create 时按主进程当前 activePlugin 记录。
   *  注意必须是 activePlugin 而非「创建方」：嵌套场景（A 渲染 B 的子页面、B 组件建 webview）下
   *  归属仍归 A（webview 属于 A 的页面上下文），layout 从 A 切到任何插件都能按归属隐藏。 */
  owner: string | null
  /** 创建该 webview 的渲染视图 id（preload 校验视图身份后传入）。两个用途：
   *  1. 视图注销（UNSET_VIEW）时按创建者精确回收，不依赖组件卸载时发出 destroy 的时序；
   *  2. webContents 事件按「创建者视图」定向推送到渲染层（不再经插件 worker 中转）。 */
  createdByViewId: string | null
  /** 组件层显式可见性（对应 ui 包 Webview 组件 WebviewProps.visible，缺省 true）；
   *  setVisible 时更新；setActivePlugin 对齐时若为 false 则硬隐藏，否则按 owner 规则判定 */
  visible: boolean
  /** 最后一次设置的 bounds（隐藏时从 contentView 移除但保留；显示时按此恢复，避免 0×0 触发页面重载） */
  bounds: { x: number; y: number; width: number; height: number }
  /** 是否已挂到窗口 contentView（隐藏 = 移除，显示 = 重新加入；webContents 自创建起保持存活不重载） */
  attached: boolean
}

export interface WebviewManagerOptions {
  /** 当前主窗口（webview 挂载到 contentView；可能为 null，创建时再取） */
  getWindow: () => BrowserWindow | null
  /** 主进程 → 渲染层指定视图推送 webContents 事件（按 createdByViewId 定向；preload 按 viewId 路由给订阅者） */
  pushEvent: (viewId: string, name: string, args: unknown[]) => void
}

export interface WebviewManager {
  create: (opts: unknown) => { viewId: string }
  update: (viewId: string, bounds: unknown) => void
  destroy: (viewId: string) => void
  /** 批量销毁某插件归属的全部 webview（插件卸载 / 覆盖安装时调用，防 worker 失效导致的泄漏） */
  destroyByOwner: (pluginId: string) => void
  /** 销毁某渲染视图创建的全部 webview（视图注销时调用，防组件卸载清理请求未送达导致的泄漏） */
  destroyByView: (viewId: string) => void
  /** 组件层显式可见性（ui 包 Webview 组件 visible prop）；同时更新 entry.visible 与视图实际可见 */
  setVisible: (viewId: string, visible: boolean) => void
  getActivePlugin: () => string | null
  /** 只读查询某 webview 的归属（owner 插件 / 创建者视图）；供 IPC 层做「仅创建者可操作」校验 */
  describe: (viewId: string) => { owner: string | null; createdByViewId: string | null } | null
  /** 基座能力（layout 切换内容区应用时调用）：更新归属并按 entry.visible 规则对齐可见性 */
  setActivePlugin: (pluginId: string | null) => void
  webContentsCall: (opts: unknown) => Promise<unknown>
  /** 应用退出时清理全部 webview */
  dispose: () => void,
  /** 显示某插件归属的 webview；views 传入时只精确恢复列表内的 view（配合 hideWebviewByPlugin 返回的 id） */
  showWebviewByPlugin: (pluginId: string, views?: string[]) => void,
  /** 隐藏某插件归属的全部 webview，返回本次实际隐藏的 view id 列表（供切回时精确恢复） */
  hideWebviewByPlugin: (pluginId: string) => string[],
}

function normalizeBounds(b: unknown): { x: number; y: number; width: number; height: number } {
  const o = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d)
  return { x: num(o.x, 0), y: num(o.y, 0), width: num(o.width, 0), height: num(o.height, 0) }
}

/**
 * 事件参数序列化安全化：
 *  - 首个参数是 Electron Event（不可克隆），直接剥离（参数前移，索引与真实事件签名对齐）；
 *  - 其余参数仅保留纯 JSON 数据（JSON 序列化，剥离不可克隆对象 / 函数 / 循环引用），
 *    保证经 postMessage 转发到 worker（utility process）一定可结构化克隆。
 */
function sanitizeArgs(args: unknown[]): unknown[] {
  return args.slice(1).map((a) => {
    if (a === null || a === undefined) return a
    if (typeof a !== 'object') return a
    try {
      const s = JSON.stringify(a)
      return s === undefined ? undefined : (JSON.parse(s) as unknown)
    } catch {
      return undefined
    }
  })
}

export function createWebviewManager(options: WebviewManagerOptions): WebviewManager {
  let seq = 0
  let activePlugin: string | null = null
  const entries = new Map<string, WebviewEntry>()

  const showWebviewByPlugin = (pluginID: string, views?: string[]) => {
    const matched: string[] = []
    console.log(`[webview:show] pluginID=${pluginID} views=${views ? JSON.stringify(views) : 'all'} entries=${JSON.stringify(Array.from(entries.values()).map((e) => ({ id: e.id, owner: e.owner, attached: e.attached, vis: e.visible })))}`)
    entries.forEach((entry) => {
      if (entry.owner !== pluginID) return;
      if (entry.visible === false) return;
      if (typeof views !== 'undefined') {
        if (!views.includes(entry.id)) return;
      }
      if (!entry.attached) {
        try {
          entry.win.contentView.addChildView(entry.view)
          entry.attached = true
        } catch {
          /* 窗口已销毁等：忽略 */
        }
      }
      if (entry.attached) {
        entry.view.setBounds(entry.bounds)
        entry.view.setVisible(true)
      }
      matched.push(entry.id)
    })
    console.log(`[webview:show] matched=${JSON.stringify(matched)}`)
  }

  const hideWebviewByPlugin = (pluginID: string): string[] => {
    const ids: string[] = []
    console.log(`[webview:hide] pluginID=${pluginID} entries=${JSON.stringify(Array.from(entries.values()).map((e) => ({ id: e.id, owner: e.owner, attached: e.attached, vis: e.visible })))}`)
    entries.forEach((entry) => {
      if (entry.owner !== pluginID) return;
      if (entry.visible === false) return;
      if (entry.attached) {
        try {
          entry.win.contentView.removeChildView(entry.view)
        } catch {
          entry.view.setVisible(false)
        }
        entry.attached = false
        ids.push(entry.id)
      }
    })
    console.log(`[webview:hide] hidden=${JSON.stringify(ids)}`)
    return ids
  }
  

  /**
   * 按 entry.visible + owner 规则计算实际显示状态，并执行「挂载/移除」式隐藏显示：
   *  显示 = 确保已挂回 contentView + 按最后 bounds 恢复 + setVisible(true)；
   *  隐藏 = 从 contentView 移除视图（webContents 自创建起保持存活，不销毁、不重载）。
   *  这是 Electron WebContentsView 推荐的 hide/show 方式（避免 display:none/0×0 导致的页面重载）。
   */
  const applyEntryVisible = (entry: WebviewEntry): void => {
    const show = entry.visible !== false && (entry.owner == null || entry.owner === activePlugin)
    if (show) {
      if (!entry.attached) {
        try {
          entry.win.contentView.addChildView(entry.view)
          entry.attached = true
        } catch {
          /* 窗口已销毁等：忽略 */
        }
      }
      if (entry.attached) {
        entry.view.setBounds(entry.bounds)
        entry.view.setVisible(true)
      }
    } else {
      if (entry.attached) {
        try {
          entry.win.contentView.removeChildView(entry.view)
        } catch {
          entry.view.setVisible(false)
        }
        entry.attached = false
      }
    }
  }

  const create = (opts: unknown): { viewId: string } => {
    const win = options.getWindow()
    const o = (typeof opts === 'object' && opts !== null ? opts : {}) as Record<string, unknown>
    if (!win) throw new Error('main window not available')
    const src = typeof o.src === 'string' ? o.src : ''
    const events = Array.isArray(o.events) ? o.events.map((e) => String(e)) : []

    // webPreferences 白名单过滤 + 强制安全项（忽略插件传入的危险字段）
    const rawPrefs = (typeof o.webPreferences === 'object' && o.webPreferences !== null ? o.webPreferences : {}) as Record<string, unknown>
    const prefs: Record<string, unknown> = { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    for (const k of SAFE_PREFS) {
      if (rawPrefs[k] !== undefined) prefs[k] = rawPrefs[k]
    }

    const id = `wv-${++seq}`
    const view = new WebContentsView({ webPreferences: prefs })

    // 归属 = 当前活动插件（内容区应用；嵌套组件场景下归属渲染上下文插件，见 WebviewEntry 说明）
    // 创建者视图 = 调用方渲染视图（preload 已校验视图身份后传入）；组件层可见性缺省 true
    const owner = activePlugin
    const createdByViewId = typeof o.createdByViewId === 'string' && o.createdByViewId ? o.createdByViewId : null
    const bounds = normalizeBounds(o.bounds)
    console.log(`[webview:create] id=${id} owner=${owner} by=${createdByViewId} activePlugin=${activePlugin} bounds=${JSON.stringify(bounds)} src=${String(src).slice(0, 80)}`)
    const entry: WebviewEntry = { id, view, win, owner, createdByViewId, visible: true, bounds, attached: true }

    // 先挂载再设 bounds：WebContentsView 未 addChildView 时 setBounds 可能不生效/被默认值覆盖
    win.contentView.addChildView(view)
    view.setBounds(bounds)
    // 可见性按归属规则对齐（与 setActivePlugin 规则统一）；组件层 visible=false 时由 Webview 组件创建后校正
    applyEntryVisible(entry)

    if (src) view.webContents.loadURL(src)

    // 白名单事件监听 → 按「创建者视图」定向推送渲染层（参数先做克隆安全化，剥离 Electron Event 等）
    for (const name of events) {
      if (!SAFE_EVENTS.has(name)) continue
      view.webContents.on(name as never, (...args: unknown[]) => {
        if (createdByViewId) options.pushEvent(createdByViewId, name, sanitizeArgs(args))
      })
    }

    entries.set(id, entry)
    return { viewId: id }
  }

  const update = (viewId: string, bounds: unknown): void => {
    const entry = entries.get(viewId)
    if (!entry) return
    const next = normalizeBounds(bounds)
    entry.bounds = next
    entry.view.setBounds(next)
  }

  const destroy = (viewId: string): void => {
    const entry = entries.get(viewId)
    if (!entry) return
    try {
      entry.win.contentView.removeChildView(entry.view)
    } catch {
      /* 已移除忽略 */
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close()
    }
    entries.delete(viewId)
    console.log(`[webview:destroy] id=${viewId} owner=${entry.owner} by=${entry.createdByViewId}`)
  }

  /**
   * 批量销毁某插件归属的全部 webview。
   * 场景：插件卸载 / 覆盖安装停掉 worker 后，组件卸载触发的 `webview:destroy` 因 worker 已死
   * 无法到达主进程（request 被静默吞掉），这里按 create 时记录的 owner 兜底清理，防 WebContentsView 泄漏。
   */
  const destroyByOwner = (pluginId: string): void => {
    for (const id of Array.from(entries.keys())) {
      if (entries.get(id)?.owner === pluginId) destroy(id)
    }
  }

  /**
   * 销毁某渲染视图创建的全部 webview。
   * 场景：PluginView 卸载时先注销视图身份（unsetView），子组件 Webview 随后发出的 destroy 会被
   * preload 验签拒绝（时序不可控）→ 由主进程按创建者视图兜底，保证「组件卸载 = 资源回收」。
   */
  const destroyByView = (viewId: string): void => {
    for (const id of Array.from(entries.keys())) {
      if (entries.get(id)?.createdByViewId === viewId) destroy(id)
    }
  }

  const setVisible = (viewId: string, visible: boolean): void => {
    const entry = entries.get(viewId)
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.visible = !!visible
      applyEntryVisible(entry)
    }
  }

  const getActivePlugin = (): string | null => activePlugin

  const describe = (viewId: string): { owner: string | null; createdByViewId: string | null } | null => {
    const entry = entries.get(viewId)
    return entry ? { owner: entry.owner, createdByViewId: entry.createdByViewId } : null
  }

  /** 基座切换内容区应用时调用（写归 layout 插件）；主进程按 entry.visible 规则对齐全部 webview 可见性 */
  const setActivePlugin = (pluginId: string | null): void => {
    activePlugin = pluginId
    // 组件层显式隐藏（visible=false）的 webview 硬隐藏；否则按 owner 归属规则对齐（worker 重启后仍正确）
    for (const [, entry] of entries) {
      applyEntryVisible(entry)
    }
  }

  const webContentsCall = async (opts: unknown): Promise<unknown> => {
    const o = (typeof opts === 'object' && opts !== null ? opts : {}) as Record<string, unknown>
    const method = String(o.method ?? '')
    if (!SAFE_METHODS.has(method)) throw new Error(`webContents method not allowed: ${method}`)
    const entry = entries.get(String(o.viewId ?? ''))
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('webview not found')
    const wc = entry.view.webContents
    const fn = wc[method as keyof typeof wc]
    if (typeof fn !== 'function') throw new Error(`webContents method not found: ${method}`)
    const args = Array.isArray(o.args) ? (o.args as unknown[]) : []
    return await (fn as (...a: unknown[]) => unknown).apply(wc, args)
  }

  const dispose = (): void => {
    for (const id of Array.from(entries.keys())) destroy(id)
  }

  return {
    create,
    update,
    destroy,
    destroyByOwner,
    destroyByView,
    setVisible,
    getActivePlugin,
    describe,
    setActivePlugin,
    webContentsCall,
    dispose,
    showWebviewByPlugin,
    hideWebviewByPlugin,
  }
}
