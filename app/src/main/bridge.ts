/**
 * 渲染层桥（bridge.ts）。
 * 渲染层通道：
 *   render:setView        PluginView 登记视图身份（view_id / plugin_id / sign_key）
 *   render:request        带签名调用 → 目标 worker（rpc-call）（兼容保留）
 *   render:validate-call  跨插件直连前校验（from 由 view 登记推导）
 *   render:ensure-worker  确保目标插件 worker 已启动（port-ready 由事件下发）
 *   render:event-*        带签名订阅 / 取消订阅 worker 推送（push → 分发）
 * 主进程 → 渲染层：
 *   render:plugin-port-ready（webContents.postMessage + transfer [port]）
 *   render:worker-exited
 * 签名校验在 preload 完成（sign_key 只存在于 preload 视图数组，不进入主进程）。
 */

import { ipcMain, type WebContents, type MessagePortMain } from 'electron'
import { DlientError, DlientErrorCode, RendererChannels } from '@dlient-open/core'
import { appendPluginLog, clearPluginLog, formatPluginLogLine, readPluginLogs, setViewLogPush } from './lib/log'
import { webviewDestroyByView } from './lib/webview'
import type { DlientRuntime } from './runtime'

export interface RendererView {
  viewId: string
  pluginId: string
}

/** 订阅记录：pluginId → viewId → { webContents, events } */
interface Subscription {
  webContents: WebContents
  events: Set<string>
}

/** UI 事件定向推送（主进程 → 渲染层指定 view；registerBridge 装配实现，notification 事件回推用） */
let uiEventPusher: ((viewId: string, event: string, data: unknown) => void) | null = null
export function setUiEventPusher(fn: ((viewId: string, event: string, data: unknown) => void) | null): void {
  uiEventPusher = fn
}
export function pushUiEvent(viewId: string, event: string, data: unknown): void {
  uiEventPusher?.(viewId, event, data)
}

export interface BridgeOptions {
  /** 主窗口 webContents（下发直连 port / 广播 worker 退出） */
  getWebContents: () => WebContents | null
  /** 确保插件 worker 启动（未运行则 startPlugin） */
  ensurePluginWorker: (pluginId: string) => Promise<{ ok: boolean; error?: string; code?: number }>
  /** 已安装插件清单（PluginView 加载前判定插件是否已安装；返回完整清单，渲染层只读） */
  listInstalledPlugins?: () => Array<{ id: string; hasDist?: boolean }>
  /** 渲染层页面就绪回调（宿主壳 mounted 后触发核心插件引导） */
  onRendererReady?: () => void
  /** 渲染层启动重试回调（非 dev 离线缺核心插件时，用户点「重试」重新走比较流程） */
  onStartupRetry?: () => void
  /** 插件组织解析（PluginView 挂载时注入 api.organization；返回 '@xxx' 或 null） */
  resolveOrg?: (pluginId: string) => Promise<string | null>
}

export function registerBridge(runtime: DlientRuntime, opts: BridgeOptions): void {
  const views = new Map<string, RendererView>()
  const subs = new Map<string, Map<string, Subscription>>()
  /** viewId → 已登记的订阅桶（自身 pluginId + 跨插件日志目标 '<filterId>@dev'）；EVENT_UNSUBSCRIBE 全桶清理用 */
  const viewBuckets = new Map<string, Set<string>>()
  const pushBridges = new Set<string>()
  /** 已就绪的插件直连 port1 缓存（幂等重发）。注意：MessagePortMain 一经 postMessage transfer 即 neutered，
   *  不可二次下发 —— sent 标记区分「未发送（可重发）」与「已发送（需重建通道）」。 */
  const readyPorts = new Map<string, { port: MessagePortMain; sent: boolean }>()
  /** webContents → 其登记过的全部 viewId；销毁时整批清理（同一 webContents 只挂一次 destroyed 监听，
   *  避免每次 SET_VIEW 都新增 once('destroyed') 导致监听器累积触发 MaxListenersExceededWarning） */
  const viewsByWebContents = new Map<WebContents, Set<string>>()

  // UI 事件定向推送（主进程 → 渲染层指定 view）：notification 句柄事件等复用 render:event 分发，
  // preload 的 eventSubs 按 viewId + 订阅名（如 'notification-event'）路由。sender 为主进程，可信。
  setUiEventPusher((viewId, event, data) => {
    for (const [wc, ids] of viewsByWebContents) {
      if (ids.has(viewId) && !wc.isDestroyed()) {
        wc.send(RendererChannels.EVENT, { viewId, event, data })
        return
      }
    }
  })

  // worker 直连 port 就绪 → 缓存并下发渲染层（preload port 表）。
  // 同实例幂等：同一 MessagePortMain 经 postMessage transfer 即 neutered，重复下发会抛
  // 「Port at index 0 is already registered」（worker 对每次 port-setup 都会回 ready）。
  runtime.setPluginPortReadyCallback((pluginId, port) => {
    const prev = readyPorts.get(pluginId)
    if (prev?.sent && prev.port === port) return
    readyPorts.set(pluginId, { port, sent: false })
    const wc = opts.getWebContents()
    if (!wc || wc.isDestroyed()) return
    wc.postMessage(RendererChannels.PLUGIN_PORT_READY, { plugin_id: pluginId }, [port])
    // postMessage 已 transfer（端口 neutered），标记 sent：后续 ensure-worker 不再二次下发该实例
    const rec = readyPorts.get(pluginId)
    if (rec) rec.sent = true
  })

  // worker 退出 / 心跳超时 → 广播渲染层（preload 清理 port + pending）
  runtime.setPluginExitedCallback((pluginId, reason) => {
    readyPorts.delete(pluginId)
    const wc = opts.getWebContents()
    if (!wc || wc.isDestroyed()) return
    wc.send(RendererChannels.WORKER_EXITED, { plugin_id: pluginId, reason: reason ?? 'exit' })
  })

  // worker 推送 → 分发给订阅该 pluginId + event 的所有 view
  function ensurePushBridge(pluginId: string): void {
    if (pushBridges.has(pluginId)) return
    pushBridges.add(pluginId)
    runtime.onPluginPush(pluginId, (event, data) => {
      const pluginSubs = subs.get(pluginId)
      if (!pluginSubs) return
      for (const [viewId, sub] of pluginSubs) {
        if (sub.events.has(event) && !sub.webContents.isDestroyed()) {
          sub.webContents.send(RendererChannels.EVENT, { viewId, event, data })
        }
      }
    })
  }

  // 宿主插件日志写入 → 分发给订阅了该 pluginId + 'plugin-log' 事件的 view（渲染层 LogViewer 实时追加）。
  // 与 worker push 分发共用 subs 表：view 经 api.onEvent('plugin-log') 订阅即可收到本插件日志，无需 plugins.dev 权限。
  setViewLogPush((pluginId, line) => {
    const pluginSubs = subs.get(pluginId)
    if (!pluginSubs) return
    for (const [viewId, sub] of pluginSubs) {
      if (sub.events.has('plugin-log') && !sub.webContents.isDestroyed()) {
        sub.webContents.send(RendererChannels.EVENT, { viewId, event: 'plugin-log', data: { pluginId, line } })
      }
    }
  })

  ipcMain.on(RendererChannels.SET_VIEW, (event, view: RendererView) => {
    if (!view || typeof view.viewId !== 'string' || typeof view.pluginId !== 'string') return
    views.set(view.viewId, view)
    // 视图可能挂载在非主窗口，销毁时清理。每个 webContents 只挂一次 destroyed 监听，
    // 其登记过的 viewId 整批回收；否则同一长生命周期 webContents（如主窗口）多次挂载
    // PluginView 会不断累积 once('destroyed')，触发 MaxListenersExceededWarning。
    const sender = event.sender
    if (!sender.isDestroyed()) {
      let own = viewsByWebContents.get(sender)
      if (!own) {
        own = new Set<string>()
        viewsByWebContents.set(sender, own)
        sender.once('destroyed', () => {
          const ids = viewsByWebContents.get(sender)
          viewsByWebContents.delete(sender)
          if (!ids) return
          for (const viewId of ids) {
            views.delete(viewId)
            for (const pluginSubs of subs.values()) {
              pluginSubs.delete(viewId)
            }
          }
        })
      }
      own.add(view.viewId)
    }
  })

  // PluginView 卸载 → 注销视图身份。只允许该 webContents 自己登记过的视图反注册，
  // 防止某个渲染层注销他人登记的 view（无签名通道，故以归属校验兜底）。
  ipcMain.on(RendererChannels.UNSET_VIEW, (event, req: { viewId?: string }) => {
    const viewId = String(req?.viewId ?? '')
    if (!viewId) return
    const own = viewsByWebContents.get(event.sender)
    if (!own?.has(viewId)) return
    own.delete(viewId)
    views.delete(viewId)
    for (const pluginSubs of subs.values()) {
      pluginSubs.delete(viewId)
    }
    // 视图注销 → 回收它创建的 WebContentsView：组件卸载时自己发出的 destroy 会因身份已注销
    // 而验签失败（React 卸载顺序为父先子），故在此按「创建者视图」兜底，确保组件卸载 = 资源回收。
    webviewDestroyByView(viewId)
  })

  // 渲染层页面就绪（宿主壳 mounted）→ 触发核心插件引导（index.ts 注入；幂等）
  ipcMain.on(RendererChannels.RENDERER_READY, () => {
    opts.onRendererReady?.()
  })

  ipcMain.on(RendererChannels.STARTUP_RETRY, () => {
    opts.onStartupRetry?.()
  })

  ipcMain.handle(RendererChannels.REQUEST, async (_event, req: { viewId: string; pluginId: string; method: string; args?: unknown[] }) => {
    const view = views.get(req?.viewId)
    if (!view || view.pluginId !== req.pluginId) {
      console.error(`[bridge] request rejected ${req?.viewId}/${req?.pluginId}: view not registered or plugin mismatch`)
      throw new DlientError(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not registered or plugin mismatch')
    }
    const result = await runtime.callWorker(view.pluginId, String(req.method), Array.isArray(req.args) ? req.args : [])
    return result
  })

  // UI 端直连 host-api（docs/guides/ui-host-api.md）：视图身份推导调用方插件（viewId → pluginId，dev=<id>@dev），
  // sender 归属校验防伪造；执行复用 executeHostApi（channel='ui'，UI_OPEN_METHODS 白名单 + permissions + 资源授权）。
  ipcMain.handle(RendererChannels.HOST_API, async (event, req: { viewId: string; method: string; args?: unknown[] }) => {
    const viewId = String(req?.viewId ?? '')
    const view = views.get(viewId)
    if (!view) throw new DlientError(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not registered')
    const own = viewsByWebContents.get(event.sender)
    if (!own?.has(viewId)) throw new DlientError(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not owned by sender')
    const method = String(req?.method ?? '')
    if (!method) throw new DlientError(DlientErrorCode.INVALID, 'host api method required')
    return runtime.executeUiHostApi(view.pluginId, method, Array.isArray(req?.args) ? req.args : [], viewId)
  })

  // 跨插件直连前校验：from_plugin_id 由 view 登记推导（不信任调用方自报）。
  // confirm 档未授权时经 authorizeCall 走运行时确认（§7），确认后放行。
  ipcMain.handle(
    RendererChannels.VALIDATE_CALL,
    async (_event, req: { viewId: string; call_plugin_id: string; method: string }) => {
      const view = views.get(req?.viewId)
      if (!view) {
        return { ok: false, error: 'view not registered' }
      }
      if (!req || typeof req.call_plugin_id !== 'string' || typeof req.method !== 'string') {
        return { ok: false, error: 'invalid validate-call params' }
      }
      return runtime.authorizeCall(view.pluginId, req.call_plugin_id, req.method)
    },
  )

  // 已安装插件清单（PluginView 加载前判定插件是否已安装；只读，返回 id + 产物就绪标记）
  ipcMain.handle(RendererChannels.LIST_PLUGINS, () => opts.listInstalledPlugins?.() ?? [])

  // 插件组织解析（PluginView 挂载时注入 api.organization；宿主主进程 resolveOrg 判定，渲染层无权限旁路）
  ipcMain.handle(RendererChannels.GET_PLUGIN_ORG, async (_event, req: { pluginId?: string }) => {
    const pluginId = String(req?.pluginId ?? '')
    if (!pluginId) return null
    try {
      return (await opts.resolveOrg?.(pluginId)) ?? null
    } catch {
      return null // 判定失败保守置空（org 层禁用），不阻断插件加载
    }
  })

  // 确保目标插件 worker 已启动；port 已就绪的幂等处理（渲染层重载/端口表清空后再要 port）
  ipcMain.handle(RendererChannels.ENSURE_WORKER, async (_event, req: { plugin_id: string }) => {
    const pluginId = String(req?.plugin_id ?? '')
    if (!pluginId) return { ok: false, error: 'invalid plugin_id', code: DlientErrorCode.INVALID }
    if (!runtime.isRunning(pluginId)) {
      const res = await opts.ensurePluginWorker(pluginId)
      if (!res.ok) return res
      // 新启动的 worker 会在就绪后触发 port-ready 回调下发，无需在此重发
      return { ok: true }
    }
    const cached = readyPorts.get(pluginId)
    if (cached && !cached.sent) {
      // 未发送过的 port：幂等重发（首次下发可能早于渲染层加载而丢失）
      const wc = opts.getWebContents()
      if (wc && !wc.isDestroyed()) {
        wc.postMessage(RendererChannels.PLUGIN_PORT_READY, { plugin_id: pluginId }, [cached.port])
        cached.sent = true
      }
      return { ok: true }
    }
    // 已发送过（port 已 neutered）或缓存丢失：重建直连通道，新 port 经 port-ready 事件异步下发
    if (runtime.refreshDirectPort(pluginId)) {
      return { ok: true }
    }
    return { ok: false, error: `no worker port for ${pluginId}`, code: DlientErrorCode.PORT_NOT_READY }
  })

  /** 订阅桶：自身 pluginId +（filterId 时）跨插件日志目标 '<filterId>@dev' */
  function logBucketKeys(pluginId: string, filterId?: string): string[] {
    return filterId ? [pluginId, `${filterId}@dev`] : [pluginId]
  }

  ipcMain.on(
    RendererChannels.EVENT_SUBSCRIBE,
    async (event, req: { viewId: string; pluginId: string; name: string; filterId?: string }) => {
      const view = views.get(req?.viewId)
      if (!view || view.pluginId !== req.pluginId) return
      const name = String(req?.name ?? '')
      if (!name) return
      const filterId = typeof req?.filterId === 'string' && String(req.filterId).trim() ? String(req.filterId).trim() : undefined
      // 跨插件日志订阅（filterId 非空）：先经宿主授权（runtime-confirm 弹框 / 已授权直接放行）；拒绝则不登记
      if (filterId) {
        const auth = await runtime.authorizeLogAccess(view.pluginId, filterId)
        if (!auth.ok) return
      }
      const buckets = logBucketKeys(view.pluginId, filterId)
      for (const key of buckets) {
        const pluginSubs = subs.get(key) ?? new Map<string, Subscription>()
        const sub = pluginSubs.get(view.viewId) ?? { webContents: event.sender, events: new Set<string>() }
        sub.events.add(name)
        pluginSubs.set(view.viewId, sub)
        subs.set(key, pluginSubs)
      }
      const set = viewBuckets.get(view.viewId) ?? new Set<string>()
      for (const key of buckets) set.add(key)
      viewBuckets.set(view.viewId, set)
      for (const key of buckets) ensurePushBridge(key)
    },
  )

  ipcMain.on(
    RendererChannels.EVENT_UNSUBSCRIBE,
    (_event, req: { viewId: string; pluginId: string; name: string; filterId?: string }) => {
      const view = views.get(req?.viewId)
      if (!view || view.pluginId !== req.pluginId) return
      const name = String(req?.name ?? '')
      const filterId = typeof req?.filterId === 'string' && String(req.filterId).trim() ? String(req.filterId).trim() : undefined
      for (const key of logBucketKeys(view.pluginId, filterId)) {
        const pluginSubs = subs.get(key)
        const sub = pluginSubs?.get(view.viewId)
        if (sub) {
          sub.events.delete(name)
          if (sub.events.size === 0) pluginSubs?.delete(view.viewId)
        }
      }
      const set = viewBuckets.get(view.viewId)
      if (set) {
        for (const key of logBucketKeys(view.pluginId, filterId)) set.delete(key)
        if (set.size === 0) viewBuckets.delete(view.viewId)
      }
    },
  )

  // ---- 插件日志写入节流（todo 7.2.8）：前端错误捕获 / 历史直写共用；按插件限流（1s 内最多 100 条） ----
  const LOG_THROTTLE_WINDOW_MS = 1000
  const LOG_THROTTLE_MAX = 100
  const pluginLogThrottle = new Map<string, { count: number; windowStart: number }>()
  function throttled(pluginId: string): boolean {
    const now = Date.now()
    const rec = pluginLogThrottle.get(pluginId)
    if (!rec || now - rec.windowStart >= LOG_THROTTLE_WINDOW_MS) {
      pluginLogThrottle.set(pluginId, { count: 1, windowStart: now })
      return true
    }
    if (rec.count >= LOG_THROTTLE_MAX) return false
    rec.count++
    return true
  }

  // ---- 宿主壳全局捕获的未处理前端错误（render:captured-error）----
  // 共享渲染进程内 window error/unhandledrejection 不含插件归属：主进程从错误栈首个
  // dlientOpen://plugin/<id>/ 帧解析目标（含 '@dev' 实例），白名单校验（当前登记视图 / 已安装清单）
  // 通过才写入该插件日志（level=error）；未命中或非白名单 → 忽略，由现有渲染层 console-message
  // 转发进主进程 [renderer:error] 兜底（不会把任意栈文本写进任意插件日志）。
  const CAPTURED_PLUGIN_ID_RE = /dlientOpen:\/\/plugin\/([^/?#]+)/i
  const CAPTURED_KINDS = new Set(['error', 'unhandledrejection'])
  function isKnownCapturedTarget(pluginId: string): boolean {
    const base = pluginId.replace(/@dev$/, '')
    if (Array.from(views.values()).some((v) => v.pluginId === pluginId || v.pluginId === base)) return true
    return (opts.listInstalledPlugins?.() ?? []).some((p) => p.id === base || p.id === pluginId)
  }
  ipcMain.on(RendererChannels.CAPTURED_ERROR, (_event, req: { kind?: string; message?: string; stack?: string }) => {
    const haystack = String(req?.stack ?? '') || String(req?.message ?? '')
    const hit = CAPTURED_PLUGIN_ID_RE.exec(haystack)
    if (!hit) return
    let pluginId = ''
    try {
      pluginId = decodeURIComponent(hit[1])
    } catch {
      pluginId = hit[1]
    }
    pluginId = pluginId.replace(/\/+$/, '')
    if (!pluginId || !isKnownCapturedTarget(pluginId)) return
    if (!throttled(pluginId)) return
    const kind = CAPTURED_KINDS.has(String(req?.kind)) ? String(req?.kind) : 'error'
    const label = kind === 'unhandledrejection' ? 'unhandled promise rejection' : 'uncaught error'
    const message = `${label}: ${String(req?.message ?? '').slice(0, 500)}`
    void appendPluginLog(pluginId, formatPluginLogLine('error', 'renderer', message, { stack: String(req?.stack ?? '').slice(0, 4000) }))
  })

  ipcMain.handle(
    RendererChannels.READ_PLUGIN_LOGS,
    async (_event, req: { viewId: string; filterId?: string; options?: { offset?: number; maxBytes?: number } }) => {
      const view = views.get(req?.viewId)
      if (!view) return { ok: false, error: 'view not registered' }
      const filterId = typeof req?.filterId === 'string' && String(req.filterId).trim() ? String(req.filterId).trim() : undefined
      let target = view.pluginId
      if (filterId) {
        const auth = await runtime.authorizeLogAccess(view.pluginId, filterId)
        if (!auth.ok) return { ok: false, error: auth.error ?? 'log access denied' }
        target = `${filterId}@dev`
      }
      return readPluginLogs(target, req?.options ?? {})
    },
  )

  // 清空插件自有日志（LogViewer 删除图标用）：视图身份推导目录；filterId 非空时清 '<filterId>@dev'（跨插件，先授权）
  ipcMain.handle(RendererChannels.CLEAR_PLUGIN_LOGS, async (_event, req: { viewId: string; filterId?: string }) => {
    const view = views.get(req?.viewId)
    if (!view) return { ok: false, error: 'view not registered' }
    const filterId = typeof req?.filterId === 'string' && String(req.filterId).trim() ? String(req.filterId).trim() : undefined
    let target = view.pluginId
    if (filterId) {
      const auth = await runtime.authorizeLogAccess(view.pluginId, filterId)
      if (!auth.ok) return { ok: false, error: auth.error ?? 'log access denied' }
      target = `${filterId}@dev`
    }
    await clearPluginLog(target)
    return { ok: true }
  })

  // 批量申请跨插件能力（api.requestPermissions）：视图身份推导调用方插件，
  // runtime-confirm 档合并进一次渲染层授权弹框；返回 { granted, denied }
  ipcMain.handle(RendererChannels.REQUEST_PERMISSIONS, async (_event, req: { viewId?: string; capabilities?: string[] }) => {
    const view = views.get(String(req?.viewId ?? ''))
    if (!view) {
      return { code: DlientErrorCode.VIEW_NOT_REGISTERED, msg: 'view not registered', data: null, from: '' }
    }
    try {
      const result = await runtime.requestPermissions(view.pluginId, Array.isArray(req.capabilities) ? req.capabilities : [])
      return { code: 0, data: result, from: '' }
    } catch (err) {
      return { code: DlientErrorCode.INTERNAL, msg: err instanceof Error ? err.message : String(err), data: null, from: '' }
    }
  })
}
