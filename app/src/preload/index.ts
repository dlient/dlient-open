/**
 * preload 签名桥 + 直连通道（preload/index.ts）。
 * 暴露给渲染层的接口：
 *   setView(view)         PluginView 挂载时登记视图身份 { view_id, plugin_id, sign_key }
 *   request(req)          带签名请求 → 直连目标 worker（自调用 / 跨插件 { target_plugin_id }）
 *   listen(req, listener) 流式请求 → 直连目标 worker，返回 { abort, signal } 控制器
 *   onEvent(name, cb, payload) 带签名的推送订阅（worker 推送）
 *   on(channel, cb)       监听主进程广播事件（plugins-ready / plugin-changed / window-state / theme）
 *
 * 插件级直连通道：
 *   - ports: Map<plugin_id, MessagePort>，主进程 fork worker 并回 direct-port-ready 后，
 *     port1 经 render:plugin-port-ready 下发，preload 存入 ports。
 *   - 跨插件调用：先 render:validate-call 校验（from 由 view 登记推导），再经目标插件 port 直连。
 *   - request_id 由 preload 生成，pending 按 id 关联，支持并发与流式。
 *
 * sign_key 只存在于本 preload 的视图数组中（contextIsolation 下渲染主世界不可读），
 * 请求必须携带 HMAC(sign_key, view_id|plugin_id|subject|timestamp) 签名，验签失败一律拒绝。
 * subject = method（自调用）或 target_plugin_id|method（跨插件）。
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron'

webFrame.setZoomFactor(1)

// 渲染层通道常量：与 @dlient-open/core 的 RendererChannels 保持一致。
// 注意：preload 为沙箱环境且打包时不应拖入 @dlient-open/core 全量（会引入 node:* 依赖），故此处内联。
const RendererChannels = {
  SET_VIEW: 'render:setView',
  UNSET_VIEW: 'render:unsetView',
  REQUEST: 'render:request',
  HOST_API: 'render:host-api',
  VALIDATE_CALL: 'render:validate-call',
  ENSURE_WORKER: 'render:ensure-worker',
  LIST_PLUGINS: 'render:list-plugins',
  GET_PLUGIN_ORG: 'render:get-plugin-org',
  RENDERER_READY: 'render:renderer-ready',
  STARTUP_RETRY: 'render:startup-retry',
  STARTUP_PROGRESS: 'render:startup-progress',
  EVENT_SUBSCRIBE: 'render:event-subscribe',
  EVENT_UNSUBSCRIBE: 'render:event-unsubscribe',
  EVENT: 'render:event',
  PLUGIN_PORT_READY: 'render:plugin-port-ready',
  WORKER_EXITED: 'render:worker-exited',
  PLUGIN_CHANGED: 'render:plugin-changed',
  PLUGIN_STATUS: 'render:plugin-status',
  WINDOW_STATE: 'render:window-state',
  PLUGINS_READY: 'render:plugins-ready',
  THEME: 'render:theme',
  LANGUAGE: 'render:language',
  READ_PLUGIN_LOGS: 'render:read-plugin-logs',
  CLEAR_PLUGIN_LOGS: 'render:clear-plugin-logs',
  CAPTURED_ERROR: 'render:captured-error',
  REQUEST_PERMISSIONS: 'render:request-permissions',
  NOTIFY: 'render:notify',
} as const

// ---- render:event 订阅注册表：单一持久监听器分发，避免逐订阅 addListener 累积触发 MaxListenersExceeded ----
interface EventSub {
  event: string
  cb: (data: unknown) => void
}
/** viewId → 订阅集合（worker push 按视图身份路由） */
const eventSubs = new Map<string, Set<EventSub>>()
let eventListenerInstalled = false

function ensureEventListener(): void {
  if (eventListenerInstalled) return
  eventListenerInstalled = true
  ipcRenderer.on(RendererChannels.EVENT, (_event, msg: { viewId?: string; event?: string; data?: unknown }) => {
    const set = typeof msg?.viewId === 'string' ? eventSubs.get(msg.viewId) : undefined
    if (!set) return
    for (const sub of Array.from(set)) {
      if (sub.event === msg.event) {
        try {
          sub.cb(msg.data)
        } catch (err) {
          console.error('[preload] event subscriber error:', err)
        }
      }
    }
  })
}

/** 注册订阅（只登记到注册表，不新增 IPC 监听）；返回取消订阅函数 */
function subscribeEvent(viewId: string, event: string, cb: (data: unknown) => void): () => void {
  ensureEventListener()
  let set = eventSubs.get(viewId)
  if (!set) {
    set = new Set()
    eventSubs.set(viewId, set)
  }
  const sub: EventSub = { event, cb }
  set.add(sub)
  return () => {
    set.delete(sub)
    if (set.size === 0) eventSubs.delete(viewId)
  }
}

/** 主进程广播事件的公开通道名 → 内部 IPC 通道（on() 白名单） */
const BROADCAST_CHANNELS: Record<string, string> = {
  'plugins-ready': RendererChannels.PLUGINS_READY,
  'startup-progress': RendererChannels.STARTUP_PROGRESS,
  'plugin-changed': RendererChannels.PLUGIN_CHANGED,
  'plugin-status-changed': RendererChannels.PLUGIN_STATUS,
  'window-state': RendererChannels.WINDOW_STATE,
  'theme': RendererChannels.THEME,
  'language': RendererChannels.LANGUAGE,
  'notify': RendererChannels.NOTIFY,
}

/** 就绪类通道：注册 on() 时回放最近一次广播（消除"广播早于订阅"竞态，如重启后 plugins-ready 卡 loading） */
const REPLAY_CHANNELS: ReadonlySet<string> = new Set(['plugins-ready', 'theme', 'language'])
/** 最近一次广播缓冲（仅 REPLAY 通道；plugin-changed/window-state 为高频实时事件，不回放避免误导/循环） */
const lastBroadcast = new Map<string, unknown>()
for (const [name, ipcChannel] of Object.entries(BROADCAST_CHANNELS)) {
  if (REPLAY_CHANNELS.has(name)) {
    ipcRenderer.on(ipcChannel, (_event, data) => {
      lastBroadcast.set(name, data)
    })
  }
}

/**
 * 统一错误码（内联，真源 @dlient-open/core errors.ts —— 改动须同步）。
 * preload 为沙箱环境，不引入 @dlient-open/core 全量，仅内联本层需要的执行/传输层码；
 * 主进程经协议 error_code 下发的校验类码（-1xxx / -2xxx）原样透传，不在此枚举。
 */
const DlientErrorCode = {
  /** 参数无效（host-api 缺 method 等） */
  INVALID: -1005,
  /** 插件 worker 未运行（worker 重启 / 退出命中的在途请求） */
  WORKER_NOT_RUNNING: -2102,
  /** 渲染层直连端口未就绪（超时） */
  PORT_NOT_READY: -2103,
  /** 渲染层请求验签失败 */
  INVALID_SIGNATURE: -2104,
  /** 渲染层视图未登记（setView 缺失）或插件不匹配 */
  VIEW_NOT_REGISTERED: -2105,
  /** 未分类内部错误 */
  INTERNAL: -2200,
  /** 插件 handler 内部未捕获异常（SDK 兜底包装为信封，列入公共表）；from 指向插件 ID */
  THROW_ERROR: -2201,
} as const

// ---- 统一响应信封（契约点 1/2/5）：from="" 为宿主侧错误，否则为插件 ID ----
/** 错误消息：字符串或 { enUS, zhCN } 多语言映射，UI 可直接展示 */
type ResponseErrorMsg = string | { enUS: string; zhCN: string }
interface ApiResponse<T = unknown> {
  code: number
  msg?: ResponseErrorMsg
  data?: T
  from: string
}

/** 构造宿主侧失败信封（from="" 表示宿主侧错误） */
function failureEnvelope(code: number, msg: string | ResponseErrorMsg): ApiResponse<null> {
  return { code, msg, data: null, from: '' }
}

/** 构造带统一错误码的 Error（渲染层 catch 后 err.code 可程序化区分；message 保留 `[ERR -xxxx]` 前缀兜底） */
function codedError(code: number, message: string): Error {
  const e = new Error(`[ERR ${code}] ${message}`)
  ;(e as Error & { code?: number }).code = code
  return e
}

interface ViewInfo {
  viewId: string
  pluginId: string
  signKey: string
}

interface SignedPayload {
  viewId: string
  pluginId: string
  method?: string
  /** 跨插件目标插件 id（缺省 = 自调用本插件 worker） */
  targetPluginId?: string
  /** 跨插件 dev 日志目标逻辑 id（logs.view 系列；并入签名防篡改） */
  filterId?: string
  name?: string
  args?: unknown[]
  data?: ArrayBuffer
  timestamp: number
  signature: string
}

/** listen 返回的取消控制器（轻量封装，规避 contextBridge 对原生 AbortController/AbortSignal 的事件对象传递问题） */
interface ListenController {
  abort(): void
  readonly signal: {
    readonly aborted: boolean
    addEventListener(cb: () => void): () => void
  }
}

/** pending 记录：request 单响应 / listen 流式 */
interface PendingEntry {
  kind: 'request' | 'listen'
  pluginId: string
  resolve?: (value: unknown) => void
  /** 单态：request 失败也 resolve 信封，不再 reject；reject 仅为兼容遗留调用保留 */
  reject?: (err: Error) => void
  listener?: (chunk: unknown, data?: ArrayBuffer) => void
}

const views = new Map<string, ViewInfo>()
/** 插件级直连 port 表（主进程 render:plugin-port-ready 下发） */
const ports = new Map<string, MessagePort>()
/** 等待插件 port 就绪的 waiter（ensurePort 用）；同时持有 reject 以便 worker 退出时主动失败 */
const portWaiters = new Map<string, Array<{ resolve: () => void; reject: (err: Error) => void }>>()
/** 请求关联表（request_id → pending） */
const pending = new Map<string, PendingEntry>()
const SIGNATURE_TTL_MS = 30_000 // 防重放：30s 内有效

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 常量时间比较（hex 字符串） */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/** 验签：view 存在 + pluginId 一致 + 时间戳新鲜 + HMAC 匹配（异步，Web Crypto） */
async function verifySignature(payload: SignedPayload): Promise<boolean> {
  if (!payload || typeof payload !== 'object') return false
  const view = views.get(payload.viewId)
  if (!view || view.pluginId !== payload.pluginId) return false
  if (typeof payload.timestamp !== 'number' || Math.abs(Date.now() - payload.timestamp) > SIGNATURE_TTL_MS) {
    return false
  }
  // subject：跨插件 = target_plugin_id|method；自调用 = method；onEvent = name
  const subject = payload.targetPluginId
    ? `${payload.targetPluginId}|${payload.method}`
    : payload.method ?? payload.name
  if (typeof subject !== 'string' || typeof payload.signature !== 'string') return false

  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(view.signKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${payload.viewId}|${payload.pluginId}|${subject}|${payload.filterId ?? ''}|${payload.timestamp}`),
    )
    return constantTimeEqual(hexFromBytes(new Uint8Array(sig)), payload.signature)
  } catch {
    return false
  }
}

// ---- 直连 port 生命周期 ----

/** 主进程下发插件直连 port（worker 就绪后） */
ipcRenderer.on(RendererChannels.PLUGIN_PORT_READY, (event, meta: { plugin_id: string }) => {
  const pluginId = String(meta?.plugin_id ?? '')
  const [port] = event.ports as MessagePort[]
  if (!pluginId || !port) return
  const existing = ports.get(pluginId)
  if (existing && existing !== port) {
    try { existing.close() } catch { /* 已关闭忽略 */ }
  }
  port.onmessage = (e: MessageEvent) => handlePortMessage(pluginId, e)
  try { port.start() } catch { /* DOM port 已自动 start */ }
  ports.set(pluginId, port)
  // resolve 等待该插件的 ensurePort waiter
  const waiters = portWaiters.get(pluginId)
  if (waiters) {
    portWaiters.delete(pluginId)
    for (const waiter of waiters) waiter.resolve()
  }
  // 插件重启：旧 pending 已不可用，清理
  failPendingForPlugin(pluginId, 'worker restarted')
})

/** worker 退出 / 心跳超时 → 清理 port + 失败 pending + 失败等待 port 的 waiter */
ipcRenderer.on(RendererChannels.WORKER_EXITED, (_event, meta: { plugin_id: string; reason?: string }) => {
  const pluginId = String(meta?.plugin_id ?? '')
  const reason = String(meta?.reason ?? 'exit')
  const port = ports.get(pluginId)
  if (port) {
    try { port.close() } catch { /* 已关闭忽略 */ }
    ports.delete(pluginId)
  }
  // 正在等该插件 port 就绪的 ensurePort 立即失败（避免干等 15s 超时）
  const waiters = portWaiters.get(pluginId)
  if (waiters) {
    portWaiters.delete(pluginId)
    for (const waiter of waiters) waiter.reject(new Error(`worker exited: ${reason}`))
  }
  failPendingForPlugin(pluginId, `worker exited: ${reason}`)
})

/** 失败某插件的全部 pending（worker 重启 / 退出） */
function failPendingForPlugin(pluginId: string, reason: string): void {
  for (const [requestId, entry] of pending) {
    if (entry.pluginId !== pluginId) continue
    pending.delete(requestId)
    if (entry.kind === 'request') {
      // 单态：worker 重启/退出导致在途请求失败 → resolve 宿主失败信封，不 reject
      entry.resolve?.(failureEnvelope(DlientErrorCode.WORKER_NOT_RUNNING, reason))
    } else {
      // listen：静默清理（UI 可通过 signal.aborted 感知）
      entry.listener = undefined
    }
  }
}

/** 确保目标插件 port 可用（未就绪则请求主进程启动并等待 port-ready） */
async function ensurePort(pluginId: string): Promise<MessagePort> {
  const existing = ports.get(pluginId)
  if (existing) return existing
  const res = (await ipcRenderer.invoke(RendererChannels.ENSURE_WORKER, { plugin_id: pluginId })) as
    { ok: boolean; error?: string; code?: number } | undefined
  if (!res?.ok) {
    const e = new Error(res?.error ?? `ensure worker failed: ${pluginId}`)
    ;(e as Error & { code?: number }).code = res?.code ?? DlientErrorCode.PORT_NOT_READY
    throw e
  }
  const after = ports.get(pluginId)
  if (after) return after
  // 等 port-ready 事件（主进程启动完成后异步下发）
  await new Promise<void>((resolve, reject) => {
    const waiters = portWaiters.get(pluginId) ?? []
    waiters.push({ resolve, reject })
    portWaiters.set(pluginId, waiters)
    setTimeout(() => reject(new Error(`port not ready: ${pluginId}`)), 15000)
  })
  const port = ports.get(pluginId)
  if (!port) throw new Error(`port not ready: ${pluginId}`)
  return port
}

/** 直连 port 消息分发（按 request_id 关联 pending） */
function handlePortMessage(pluginId: string, event: MessageEvent): void {
  const msg = event.data as {
    type: string
    request_id?: string
    result?: unknown
    error?: string
    error_code?: number
    chunk?: unknown
    data?: ArrayBuffer
  }
  const requestId = msg.request_id
  if (!requestId) return
  const entry = pending.get(requestId)
  if (!entry || entry.pluginId !== pluginId) return

  switch (msg.type) {
    case 'response': {
      if (entry.kind === 'request') {
        pending.delete(requestId)
        entry.resolve?.(msg.result)
      }
      break
    }
    case 'error': {
      pending.delete(requestId)
      if (entry.kind === 'request') {
        // 单态：失败也 resolve 信封（worker 已下发信封时原样透传；否则以 error_code/error 构造宿主失败信封）
        entry.resolve?.(msg.result ?? failureEnvelope(msg.error_code ?? DlientErrorCode.INTERNAL, msg.error ?? 'request failed'))
      }
      break
    }
    case 'stream': {
      if (entry.kind === 'listen') {
        entry.listener?.(msg.chunk, msg.data)
      }
      break
    }
    case 'stream-done': {
      if (entry.kind === 'listen') {
        pending.delete(requestId)
      }
      break
    }
    case 'stream-error': {
      if (entry.kind === 'listen') {
        pending.delete(requestId)
      }
      break
    }
  }
}

const dlientBridge = {
  setView: (view: ViewInfo): void => {
    if (!view || typeof view.viewId !== 'string' || typeof view.pluginId !== 'string' || typeof view.signKey !== 'string') {
      return
    }
    views.set(view.viewId, view)
    ipcRenderer.send(RendererChannels.SET_VIEW, { viewId: view.viewId, pluginId: view.pluginId })
  },

  /** PluginView 卸载时注销视图身份（清除本地 sign_key 表并通知主进程回收 view 登记） */
  unsetView: (viewId: string): void => {
    if (typeof viewId !== 'string' || !viewId) return
    views.delete(viewId)
    eventSubs.delete(viewId)
    ipcRenderer.send(RendererChannels.UNSET_VIEW, { viewId })
  },

  /** 渲染层页面已就绪（宿主壳 mounted）：主进程据此启动核心插件引导流程 */
  rendererReady: (): void => {
    ipcRenderer.send(RendererChannels.RENDERER_READY)
  },

  /** 启动重试（非 dev 离线缺核心插件时，用户点「重试」重新走比较流程） */
  retryStartup: (): void => {
    ipcRenderer.send(RendererChannels.STARTUP_RETRY)
  },

  /** 查询已安装插件清单（PluginView 加载前判定插件是否已安装；只读） */
  listInstalledPlugins: (): Promise<InstalledPluginInfo[]> =>
    ipcRenderer.invoke(RendererChannels.LIST_PLUGINS) as Promise<InstalledPluginInfo[]>,

  /** 解析插件组织标识（'@xxx'；宿主主进程 resolveOrg 判定，未登录/篡改/无组织 → null） */
  getPluginOrg: (pluginId: string): Promise<string | null> =>
    ipcRenderer.invoke(RendererChannels.GET_PLUGIN_ORG, { pluginId: String(pluginId ?? '') }) as Promise<string | null>,

  /** 直连请求：自调用（targetPluginId 缺省）或跨插件直连目标 worker；单态成功后 resolve 信封（成功/fail 均不 reject） */
  request: async (payload: SignedPayload): Promise<unknown> => {
    if (!(await verifySignature(payload))) {
      return failureEnvelope(DlientErrorCode.INVALID_SIGNATURE, 'invalid view signature')
    }
    const view = views.get(payload.viewId)
    if (!view) return failureEnvelope(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not registered')
    const targetPluginId = payload.targetPluginId ?? view.pluginId
    const method = String(payload.method ?? '')

    // 跨插件：主进程校验（from 由 view 登记推导，不信任调用方）
    if (payload.targetPluginId) {
      const check = (await ipcRenderer.invoke(RendererChannels.VALIDATE_CALL, {
        viewId: payload.viewId,
        call_plugin_id: payload.targetPluginId,
        method,
      })) as { ok: boolean; error?: string; code?: number } | undefined
      if (!check?.ok) return failureEnvelope(check?.code ?? DlientErrorCode.INTERNAL, check?.error ?? 'validate-call failed')
    }

    let port: MessagePort
    try {
      port = await ensurePort(targetPluginId)
    } catch (err) {
      // 单态：端口就绪失败返回宿主失败信封（透传 ensure-worker 失败码），不 reject
      const code = (err as { code?: number })?.code ?? DlientErrorCode.PORT_NOT_READY
      return failureEnvelope(code, err instanceof Error ? err.message : String(err))
    }
    const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    return new Promise<unknown>((resolve) => {
      pending.set(requestId, { kind: 'request', pluginId: targetPluginId, resolve })
      const message = { type: 'request' as const, request_id: requestId, from_plugin_id: view.pluginId, method, args: payload.args ?? [], data: payload.data }
      port.postMessage(message, payload.data ? [payload.data] : [])
    })
  },

  /** 流式请求：返回稳定的 { abort, signal } 控制器，abort() 向 worker 发 cancel */
  listen: (payload: SignedPayload, listener: (chunk: unknown, data?: ArrayBuffer) => void): ListenController => {
    const ac = new AbortController()
    const state: { active: boolean; port: MessagePort | null; requestId: string | null } = { active: true, port: null, requestId: null }

    const controller: ListenController = {
      abort: () => {
        if (!state.active) return
        state.active = false
        ac.abort()
        if (state.port && state.requestId) {
          try {
            state.port.postMessage({ type: 'cancel', request_id: state.requestId })
          } catch {
            /* 已关闭忽略 */
          }
          pending.delete(state.requestId)
        }
      },
      signal: {
        get aborted() {
          return ac.signal.aborted
        },
        addEventListener: (cb: () => void) => {
          const handler = () => cb()
          ac.signal.addEventListener('abort', handler)
          return () => ac.signal.removeEventListener('abort', handler)
        },
      },
    }

    void (async () => {
      if (!(await verifySignature(payload))) {
        state.active = false
        ac.abort()
        return
      }
      const view = views.get(payload.viewId)
      if (!view) {
        state.active = false
        ac.abort()
        return
      }
      const targetPluginId = payload.targetPluginId ?? view.pluginId
      const method = String(payload.method ?? '')

      if (payload.targetPluginId) {
        const check = (await ipcRenderer.invoke(RendererChannels.VALIDATE_CALL, {
          viewId: payload.viewId,
          call_plugin_id: payload.targetPluginId,
          method,
        })) as { ok: boolean; error?: string }
        if (!check?.ok) {
          state.active = false
          ac.abort()
          return
        }
      }

      const port = await ensurePort(targetPluginId).catch(() => null)
      if (!port || !state.active) {
        state.active = false
        return
      }
      const requestId = `lst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      state.port = port
      state.requestId = requestId
      pending.set(requestId, { kind: 'listen', pluginId: targetPluginId, listener })
      const message = { type: 'listen' as const, request_id: requestId, from_plugin_id: view.pluginId, method, args: payload.args ?? [], data: payload.data }
      port.postMessage(message, payload.data ? [payload.data] : [])
    })()

    return controller
  },

  onEvent: (name: string, callback: (data: unknown) => void, payload: SignedPayload): (() => void) => {
    let unsubscribed = false
    let dispose: (() => void) | null = null

    void verifySignature(payload).then((ok) => {
      if (!ok || unsubscribed) return
      ipcRenderer.send(RendererChannels.EVENT_SUBSCRIBE, {
        viewId: payload.viewId,
        pluginId: payload.pluginId,
        name,
        filterId: payload.filterId,
      })
      // 注册表分发（render:event 只挂一个持久监听器），不再逐订阅 addListener
      const unsub = subscribeEvent(payload.viewId, name, callback)
      dispose = () => {
        unsub()
        ipcRenderer.send(RendererChannels.EVENT_UNSUBSCRIBE, {
          viewId: payload.viewId,
          pluginId: payload.pluginId,
          name,
          filterId: payload.filterId,
        })
      }
      if (unsubscribed) dispose()
    })

    return () => {
      unsubscribed = true
      dispose?.()
    }
  },

  /**
   * 监听主进程广播事件（plugins-ready / plugin-changed / window-state / theme）。
   * 通道白名单见 BROADCAST_CHANNELS；返回取消订阅函数。
   */
  on: (channel: string, callback: (data: unknown) => void): (() => void) => {
    const ipcChannel = BROADCAST_CHANNELS[channel]
    if (!ipcChannel || typeof callback !== 'function') return () => {}
    // 就绪类通道：若广播早于订阅发生（重启竞态），立即回放最近一次
    if (REPLAY_CHANNELS.has(channel) && lastBroadcast.has(channel)) {
      const data = lastBroadcast.get(channel)
      queueMicrotask(() => callback(data))
    }
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      callback(data)
    }
    ipcRenderer.on(ipcChannel, listener)
    return () => {
      ipcRenderer.removeListener(ipcChannel, listener)
    }
  },

  /**
   * 宿主壳全局捕获的未处理前端错误上报（宿主渲染层自身调用；主进程从栈解析插件归属 + 白名单校验后才写日志）
   */
  reportCapturedError: (payload: { kind: 'error' | 'unhandledrejection'; message: string; stack?: string }): void => {
    if (!payload || typeof payload !== 'object') return
    ipcRenderer.send(RendererChannels.CAPTURED_ERROR, {
      kind: String(payload?.kind === 'unhandledrejection' ? 'unhandledrejection' : 'error'),
      message: String(payload?.message ?? '').slice(0, 2000),
      stack: typeof payload?.stack === 'string' ? payload.stack.slice(0, 8000) : undefined,
    })
  },

  /** 读取插件自有日志（todo 7.2.9，增量 tail）：签名校验 + 视图身份推导目录；filterId 非空读 '<filterId>@dev'（跨插件），透传 { offset, maxBytes } 返回新行 */
  readPluginLogs: async (payload: {
    viewId: string
    pluginId: string
    filterId?: string
    options?: { offset?: number; maxBytes?: number }
    timestamp: number
    signature: string
  }): Promise<unknown> => {
    if (!(await verifySignature({ ...payload, name: 'read-logs' } as SignedPayload))) {
      throw codedError(DlientErrorCode.INVALID_SIGNATURE, 'invalid view signature')
    }
    const view = views.get(payload.viewId)
    if (!view || view.pluginId !== payload.pluginId) {
      throw codedError(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not registered or plugin mismatch')
    }
    return ipcRenderer.invoke(RendererChannels.READ_PLUGIN_LOGS, {
      viewId: payload.viewId,
      filterId: payload.filterId,
      options: payload.options,
    })
  },

  /** 清空插件自有日志（LogViewer 删除图标用）：签名校验 + 视图身份推导目录；filterId 非空清 '<filterId>@dev'（跨插件） */
  clearLogs: async (payload: {
    viewId: string
    pluginId: string
    filterId?: string
    timestamp: number
    signature: string
  }): Promise<unknown> => {
    if (!(await verifySignature({ ...payload, name: 'clear-logs' } as SignedPayload))) {
      throw codedError(DlientErrorCode.INVALID_SIGNATURE, 'invalid view signature')
    }
    const view = views.get(payload.viewId)
    if (!view || view.pluginId !== payload.pluginId) {
      throw codedError(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not registered or plugin mismatch')
    }
    return ipcRenderer.invoke(RendererChannels.CLEAR_PLUGIN_LOGS, {
      viewId: payload.viewId,
      filterId: payload.filterId,
    })
  },

  /** 批量申请跨插件能力（'pluginId.method' 数组）：签名 subject='request-permissions'；宿主裁决后返回 { granted, denied } */
  requestPermissions: async (payload: {
    viewId: string
    pluginId: string
    capabilities: string[]
    timestamp: number
    signature: string
  }): Promise<unknown> => {
    if (!(await verifySignature({ ...payload, name: 'request-permissions' } as SignedPayload))) {
      throw codedError(DlientErrorCode.INVALID_SIGNATURE, 'invalid view signature')
    }
    const view = views.get(payload.viewId)
    if (!view || view.pluginId !== payload.pluginId) {
      throw codedError(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not registered or plugin mismatch')
    }
    return ipcRenderer.invoke(RendererChannels.REQUEST_PERMISSIONS, {
      viewId: payload.viewId,
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    })
  },

  /** UI 端直连 host-api（docs/guides/ui-host-api.md）：签名 subject = method（与 sign(method) 一致）；
   *  主进程按 viewId → pluginId 推导身份（不信自报），执行走 executeHostApi(channel='ui')。 */
  hostApi: async (payload: {
    viewId: string
    pluginId: string
    method: string
    args?: unknown[]
    timestamp: number
    signature: string
  }): Promise<unknown> => {
    if (!(await verifySignature(payload))) {
      throw codedError(DlientErrorCode.INVALID_SIGNATURE, 'invalid view signature')
    }
    const view = views.get(payload.viewId)
    if (!view || view.pluginId !== payload.pluginId) {
      throw codedError(DlientErrorCode.VIEW_NOT_REGISTERED, 'view not registered or plugin mismatch')
    }
    const method = String(payload.method ?? '')
    if (!method) throw codedError(DlientErrorCode.INVALID, 'host api method required')
    return ipcRenderer.invoke(RendererChannels.HOST_API, {
      viewId: payload.viewId,
      method,
      args: Array.isArray(payload.args) ? payload.args : [],
    })
  },

  /** 内置宿主壳首方通道（layout / setting 并入宿主后使用；宿主壳为可信首方 UI，无插件授权语义） */
  hostShell: {
    windowClose: () => ipcRenderer.invoke('host-shell:window-close'),
    windowMinimize: () => ipcRenderer.invoke('host-shell:window-minimize'),
    windowMaximize: () => ipcRenderer.invoke('host-shell:window-maximize'),
    windowUnmaximize: () => ipcRenderer.invoke('host-shell:window-unmaximize'),
    windowRestore: () => ipcRenderer.invoke('host-shell:window-restore'),
    windowSetFullScreen: (flag: boolean) => ipcRenderer.invoke('host-shell:window-set-fullscreen', flag),
    windowIsMaximized: () => ipcRenderer.invoke('host-shell:window-is-maximized'),
    menuPopup: (opts: unknown) => ipcRenderer.invoke('host-shell:menu-popup', opts),
    setActiveApp: (pluginId: string | null) => ipcRenderer.invoke('host-shell:set-active-app', pluginId),
    listPlugins: () => ipcRenderer.invoke('host-shell:list-plugins'),
    checkReadiness: (pluginId: string, manifest?: unknown) =>
      ipcRenderer.invoke('host-shell:check-readiness', pluginId, manifest),
    nodejsStatus: (opts?: { version?: string }) => ipcRenderer.invoke('host-shell:nodejs-status', opts),
    nodejsInstall: (version?: string) => ipcRenderer.invoke('host-shell:nodejs-install', version),
    nodejsProgress: () => ipcRenderer.invoke('host-shell:nodejs-progress'),
    previewImportPlugin: () => ipcRenderer.invoke('host-shell:preview-import-plugin'),
    confirmImportPlugin: (filePath: string) => ipcRenderer.invoke('host-shell:install-import-plugin', filePath),
    uninstallPlugin: (pluginId: string) => ipcRenderer.invoke('host-shell:uninstall-plugin', pluginId),
    settingsGet: () => ipcRenderer.invoke('host-shell:settings-get'),
    settingsSet: (partial: unknown) => ipcRenderer.invoke('host-shell:settings-set', partial),
    about: () => ipcRenderer.invoke('host-shell:about'),
  },
}

contextBridge.exposeInMainWorld('dlient', dlientBridge)
