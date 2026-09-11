/**
 * createWorkerRpc - 插件 worker（utilityProcess）端辅助。
 * 双通道：
 *   - parentPort 主通道：init / rpc-call（主进程 invokePlugin 转发）/ host-api / 心跳 / port-setup
 *   - directPort 直连通道（MessageChannelMain）：渲染层 preload 直连
 *     request/listen → 执行 registerHandler/registerStreamHandler → 自动按 request_id 回传
 * 插件开发者不感知 port 与 request_id：handler(args, ctx) 即可。
 */

import type {
  PluginMessage,
  RpcResponseMessage,
  HostApiCallMessage,
  HostApiResponseMessage,
  PushMessage,
  DirectRequestMessage,
  DirectListenMessage,
  DirectPortMessage,
  SnapshotRequestMessage,
  SnapshotResponseMessage,
  SnapshotRestoreMessage,
  ChildControlMessage,
  ChildControlResponseMessage,
  ChildSubscribeMessage,
  NotificationEventMessage,
} from './protocol'
import {
  createNativeHostClient,
  createHostedTransport,
  createRestartableNativeHost,
  type NativeHostClient,
  type RestartableNativeHost,
} from '@dlient-open/native-host-sdk'
import type { HostApiSurface, NotificationHandle, NotificationEventPayload, NotificationSendOptions } from './host-api'
import { createHostApiModules } from './host-api'
import type { ChildHandle, ChildEventHandlers, SpawnHostedOptions } from '@dlient-open/api-types'
export type { ChildHandle, ChildEventHandlers, SpawnHostedOptions } from '@dlient-open/api-types'

/**
 * 通道（控制面 / 直连）：兼容 Electron MessagePortMain 与 utilityProcess parentPort。
 * 共享池模式下控制/直连通道由池运行时注入（见 pool-worker.ts），独立进程模式用 process.parentPort。
 */
interface RpcChannel {
  postMessage(message: unknown, transfer?: unknown[]): void
  on(event: 'message', listener: (event: { data: unknown; ports?: unknown[] }) => void): void
  /** 解绑监听（MessagePortMain / parentPort 均支持；缺省时退化为监听器比对过滤） */
  off?(event: 'message', listener: (event: { data: unknown; ports?: unknown[] }) => void): void
  start?(): void
}

/** 池上下文：pool-worker 加载插件前设置，createWorkerRpc 同步读取 */
interface PoolContext {
  pluginId?: string
  controlPort?: RpcChannel
  directPort?: RpcChannel
}

/** 池运行时读写全局键（与 pool-worker.ts 一致） */
const POOL_CTX_KEY = '__dlientPoolCtx'
const RPC_TABLE_KEY = '__dlientRpcTable'

/**
 * 统一错误码（内联，真源 @dlient-open/core errors.ts —— 改动须同步）。
 * worker 端仅用执行层/兜底码；宿主校验类码（-2xxx）由主进程下发 error_code 原样透传。
 */
const WorkerErrorCode = {
  OK: 0,
  /** worker 端未注册该 handler */
  METHOD_NOT_REGISTERED: -2101,
  /** 未分类内部错误 */
  INTERNAL: -2200,
  /** handler 内 throw 且未携带业务码时的兜底码 */
  THROW_ERROR: -2201,
} as const

/** 业务错误码起始值：插件自管码须 <= 该值（宿主不解释其含义，见 docs/specs/errors.md） */
export const PLUGIN_ERROR_START = -3001

/** 错误消息：字符串或 { enUS, zhCN } 多语言映射，渲染层按 locale 解析 */
export type ResponseErrorMsg = string | { enUS: string; zhCN: string }

/** 统一响应信封：from="" 为宿主侧，否则为插件 ID */
export interface ApiResponse<T = unknown> {
  code: number
  msg?: ResponseErrorMsg
  data?: T
  from: string
}

/**
 * 插件业务错误：handler 内 throw，SDK 兜底包装为失败信封（不 reject）。
 * code 为插件自管业务码（约定 <= PLUGIN_ERROR_START）；msg 支持多语言对象。
 */
export class PluginError extends Error {
  readonly code: number
  readonly msg?: ResponseErrorMsg

  constructor(code: number, msg?: ResponseErrorMsg) {
    super(typeof msg === 'string' ? msg : (msg?.zhCN ?? msg?.enUS ?? `plugin error ${code}`))
    this.name = 'PluginError'
    this.code = code
    this.msg = msg
  }
}

/** 从任意错误提取数值错误码（PluginError / {code:number} 优先），无码返回 undefined */
function extractErrorCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'number') {
    return (err as { code: number }).code
  }
  return undefined
}

/** 从任意错误提取信封 msg（PluginError 保留多语言对象），否则取 message 字符串 */
function extractErrorMsg(err: unknown): ResponseErrorMsg {
  if (err instanceof PluginError && err.msg !== undefined) return err.msg
  if (err && typeof err === 'object' && 'msg' in err) {
    const m = (err as { msg?: unknown }).msg
    if (typeof m === 'string') return m
    if (m && typeof m === 'object' && typeof (m as { enUS?: unknown }).enUS === 'string') {
      return m as { enUS: string; zhCN: string }
    }
  }
  return err instanceof Error ? err.message : String(err)
}

/** 判断 handler 返回值是否已是信封（已是则原样透传，避免二次包装） */
function isEnvelope(value: unknown): value is ApiResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { code?: unknown }).code === 'number' &&
    typeof (value as { from?: unknown }).from === 'string'
  )
}

/** 构造带统一错误码的 Error（插件侧 catch 后可用 err.code 程序化区分） */
function codedError(code: number, message: string): Error {
  const e = new Error(message)
  ;(e as Error & { code?: number }).code = code
  return e
}

type WorkerRpcHandler = (args: unknown[], ctx?: HandlerContext) => unknown | Promise<unknown>

/** handler 执行上下文（directPort 直连调用时填充） */
export interface HandlerContext {
  from_plugin_id: string
  request_id: string
  /** 请求携带的大块数据（transfer 零拷贝） */
  data?: ArrayBuffer
  /** 流式发射（仅 registerStreamHandler / listen 模式可用） */
  emit?: (chunk?: unknown, opts?: { data?: ArrayBuffer }) => void
  /** 取消信号（UI 发 cancel 时 abort） */
  signal: AbortSignal
}

/** rpc.xx.xx：宿主能力统一经 rpc.<module>.<method>(...args) 调用（模块/方法静态快照见 host-api.ts）。 */

/** 宿主代管子进程事件回调（child.spawn 的 child-event 流式推送分发目标） */
export interface WorkerRpc extends HostApiSurface {
  registerHandler: (method: string, handler: WorkerRpcHandler) => void
  /** 流式 handler：ctx.emit(chunk) 多次，return 后自动发 stream-done */
  registerStreamHandler: (method: string, handler: WorkerRpcHandler) => void
  /** 跨插件调用（plugin.invoke）：见 rpc.plugin.invoke（expose + dependencies 由主进程校验） */
  /** 注册宿主代管子进程（child.spawn）事件回调（child-event 流式推送分发） */
  registerChildEvent: (handleId: string, handlers: ChildEventHandlers) => void
  /** 注销子进程事件回调 */
  unregisterChildEvent: (handleId: string) => void
  /** 订阅 child 句柄事件（child-subscribe：宿主回放缓冲 + 实时流；registerChildEvent 后立即调用） */
  childSubscribe: (handleId: string) => void
  /** child 句柄控制（child-control：kill/stdin；句柄内聚后不再走 host-api） */
  childControl: (handleId: string, op: 'kill' | 'write' | 'end', data?: string) => Promise<void>
  /** 推送事件给绑定本插件的渲染层 view（经主进程转发） */
  push: (event: string, data?: unknown) => void
  /** 构造成功信封 { code: 0, data, from: plugin_id }（handler return 裸数据时 SDK 自动归一，无需显式调用） */
  success: <T>(data?: T) => ApiResponse<T>
  /** 构造失败信封 { code, msg, data: null, from: plugin_id }；code 为插件自管业务码（<= PLUGIN_ERROR_START） */
  error: (code: number, msg?: ResponseErrorMsg) => ApiResponse<null>
  /** 业务状态快照：热重载/重启前主进程请求（1s 窗口），插件实现返回可序列化状态 */
  registerSnapshotHandler: (handler: () => unknown | Promise<unknown>) => void
  /** 业务状态恢复：重启后主进程回灌快照，插件据此恢复状态 */
  registerRestoreHandler: (handler: (snapshot: unknown) => void | Promise<void>) => void
  /**
   * 注册可逆副作用（对齐 Cordis ctx.effect）：install() 返回 disposer，
   * worker 被宿主停止前逆序执行（优雅清理；如关闭服务器 / kill 自 spawn 子进程）。
   */
  effect: (install: () => unknown | Promise<unknown> | void | Promise<void>) => void
  /** 注册就绪回调（directPort/控制面就绪后触发一次；对齐 cordis ready） */
  onReady: (cb: () => void) => void
  /** 注册宿主停止前回调（可返回 Promise 等待；对齐 cordis dispose，先于 effect disposers 执行） */
  onDispose: (cb: () => unknown | Promise<unknown>) => void
  getPluginId: () => string
  /**
   * 便捷启动 native-host（docs/specs/dlient-package.md）：宿主按 fileName 在插件 dist 查找入口并代 spawn 官方 Node，
   * 内部 resolve nodejs.resolveRuntime；host 内置崩溃自动重启（maxRestarts 默认 10）。
   * 返回 { host, client, error }；host.onRestarted 注册"重启后恢复"回调；rpc.effect(() => host.stop()) 优雅回收。
   */
  createNativeHost: (
    fileName: string,
    opts?: { maxRestarts?: number; backoffMs?: number; maxBackoffMs?: number },
  ) => Promise<CreateNativeHostResult>
}

/** rpc.createNativeHost 返回：host（自动重启 + onRestarted/onExit/stop）+ client（host.call 同源客户端）+ error */
export interface CreateNativeHostResult {
  host: (RestartableNativeHost & { onRestarted: (cb: () => void) => void }) | null
  client: NativeHostClient | null
  error?: string
}

export function createWorkerRpc(pluginId: string): WorkerRpc {
  const handlers = new Map<string, WorkerRpcHandler>()
  const streamHandlers = new Set<string>()
  let messageId = 0
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()
  /** directPort（渲染层直连通道）；池注入或 port-setup 消息时设置 */
  let directPort: RpcChannel | null = null
  /** 在途流式/请求的 AbortController（cancel 时 abort） */
  const inFlight = new Map<string, AbortController>()
  /** 业务状态快照/恢复 handler（热重载/重启用；未注册则跳过快照） */
  let snapshotHandler: (() => unknown | Promise<unknown>) | undefined
  let restoreHandler: ((snapshot: unknown) => void | Promise<void>) | undefined
  /** 可逆副作用 disposers（rpc.effect 注册；宿主停止前逆序执行） */
  const disposers: Array<() => unknown> = []
  /** onReady 回调（就绪触发一次；对齐 cordis ready） */
  const onReadyCallbacks: Array<() => void> = []
  /** onDispose 回调（宿主停止前先于 effect disposers 执行；可返回 Promise 等待） */
  const onDisposeCallbacks: Array<() => unknown | Promise<unknown>> = []
  let readyFired = false
  const fireReady = (): void => {
    if (readyFired) return
    readyFired = true
    for (const cb of onReadyCallbacks) {
      try {
        cb()
      } catch (err) {
        console.error(`[plugin:${activePluginId}] onReady failed:`, err)
      }
    }
  }

  // 通道解析：池上下文（pool-worker 注入）优先，其次 process.parentPort（独立进程）
  const poolCtx = (globalThis as unknown as Record<string, unknown>)[POOL_CTX_KEY] as PoolContext | undefined
  // process.parentPort 为 Electron utilityProcess 专有属性（Node 的 Process 类型未声明）→ 断言读取
  const procParentPort = (process as unknown as { parentPort?: RpcChannel }).parentPort
  const ctl: RpcChannel | undefined = poolCtx?.controlPort ?? (typeof process !== 'undefined' ? procParentPort : undefined)

  // 运行标识：优先宿主下发的 instanceKey（池模式经 poolCtx 同步注入；独立进程模式 init 后更新）。
  // dev 实例 = '<id>@dev'，与正式实例 '<id>' 隔离 —— rpc 表键 / 推送 / host-api owner 均按此区分。
  let activePluginId = poolCtx?.pluginId ?? pluginId
  /** 宿主代管子进程事件回调表（child-event 按 handleId 分发） */
  const childEventListeners = new Map<string, ChildEventHandlers>()
  /** notification 句柄事件回调表（notification-event 按 id 分发；句柄 close 时注销） */
  const notificationHandles = new Map<string, { events: Map<string, Array<(payload?: NotificationEventPayload) => void>> }>()

  const sendMessage = (msg: PluginMessage) => {
    ctl?.postMessage(msg)
  }

  /** 成功信封（from 取运行标识 activePluginId，dev 实例为 '<id>@dev'） */
  const toSuccessEnvelope = <T>(data?: T): ApiResponse<T> => ({
    code: WorkerErrorCode.OK,
    data,
    from: activePluginId,
  })

  /** 失败信封（handler throw 兜底 / rpc.error 共用） */
  const toFailureEnvelope = (code: number, msg?: ResponseErrorMsg): ApiResponse<null> => ({
    code,
    msg,
    data: null,
    from: activePluginId,
  })

  // ---- directPort 直连消息处理（渲染层 preload 发出）----

  /**
   * 注意：utilityProcess 下发的 directPort 是 Electron MessagePortMain，
   * 其 postMessage 的 transfer 仅接受 MessagePortMain[]（不支持 ArrayBuffer），
   * 且传 undefined 第二参也会抛 "transferables must be an array of MessagePorts"。
   * 因此 data 字段一律随消息结构化克隆（深拷贝），不启用 transfer。
   */
  const sendDirect = (msg: DirectPortMessage) => {
    if (!directPort) return
    directPort.postMessage(msg)
  }

  const handleDirectMessage = (event: { data: DirectPortMessage }) => {
    const msg = event.data
    switch (msg.type) {
      case 'request':
        runDirectHandler(msg, false)
        break
      case 'listen':
        runDirectHandler(msg, true)
        break
      case 'cancel':
        inFlight.get(msg.request_id)?.abort()
        inFlight.delete(msg.request_id)
        break
    }
  }

  /** 已绑定 message 监听的直连通道集合（防同一 port 重复绑定） */
  const listenedPorts = new Set<RpcChannel>()
  /** 当前生效的 message 监听器（换 port 时用 off 解绑旧监听；无 off 时靠闭包比对过滤） */
  let directListener: ((event: { data: unknown; ports?: unknown[] }) => void) | undefined

  /**
   * 设置并监听直连通道（池注入 directPort / port-setup 消息 / reattach-direct 共用）。
   *
   * 幂等守卫（缺一则同一 request 会被处理多次 → handler 副作用双份，如系统弹框弹两次）：
   * 1. 同一 port 重复调用只绑定一次监听（listenedPorts 记录）——池模式下 SDK 顶层已用
   *    poolCtx.directPort 完成握手，宿主若再经 rpcTable 补触发即命中此守卫。
   * 2. 换 port（reattach-direct / port-setup）时先 off 解绑旧监听（RpcChannel.off）；
   *    不支持 off 的通道退化为「监听闭包比对当前 directPort」过滤僵尸监听。
   */
  const setupDirectPort = (port: RpcChannel) => {
    const isNewListener = !listenedPorts.has(port)
    if (directListener && directPort && directPort !== port) {
      directPort.off?.('message', directListener)
      directListener = undefined
    }
    directPort = port
    if (isNewListener) {
      listenedPorts.add(port)
      directListener = (payload) => {
        // 无 off 通道的僵尸监听兜底：已切换到新 port，忽略（避免重复/错通道回包）
        if (directPort !== port) return
        handleDirectMessage(payload as { data: DirectPortMessage })
      }
      port.on('message', directListener)
      port.start?.()
    }
    sendMessage({ type: 'direct-port-ready', pluginId: activePluginId })
    // 直连端口就绪 = worker 可被渲染层访问 → 触发 onReady（生命周期 12.3.5-④）
    fireReady()
  }

  // 池模式直连通道注入（pool-worker 随 load-plugin transfer 的 direct port；同步生效）
  const directInit = poolCtx?.directPort
  if (directInit) setupDirectPort(directInit)

  // 注册到池 rpc 表：池运行时重建直连通道（reattach-direct 消息）时按 pluginId 调用
  // （独立进程模式无 pool-worker，表仅被池运行时消费；全局键与 pool-worker.ts 一致）
  const rpcTable = ((globalThis as unknown as Record<string, unknown>)[RPC_TABLE_KEY] ??= {}) as Record<
    string,
    { setDirectPort?: (port: RpcChannel) => void }
  >
  rpcTable[activePluginId] = { setDirectPort: setupDirectPort }

  /** 执行 directPort 请求并自动按 request_id 回传（并发：每条消息独立 Promise，不互相等待） */
  function runDirectHandler(msg: DirectRequestMessage | DirectListenMessage, isStream: boolean): void {
    const handler = handlers.get(msg.method)
    if (!handler) {
      const error = `Method "${msg.method}" not found`
      // 未注册也以信封 result 返回（不走 reject），UI 统一按 code 判断（docs/specs/errors.md 跨层透传约定）
      sendDirect({
        type: 'error',
        request_id: msg.request_id,
        error,
        error_code: WorkerErrorCode.METHOD_NOT_REGISTERED,
        result: toFailureEnvelope(WorkerErrorCode.METHOD_NOT_REGISTERED, error),
      })
      return
    }
    const ac = new AbortController()
    inFlight.set(msg.request_id, ac)

    const emit = (chunk?: unknown, opts?: { data?: ArrayBuffer }) => {
      sendDirect({ type: 'stream', request_id: msg.request_id, chunk, data: opts?.data })
    }

    const ctx: HandlerContext = {
      from_plugin_id: msg.from_plugin_id,
      request_id: msg.request_id,
      data: msg.data,
      signal: ac.signal,
      emit: isStream ? emit : undefined,
    }

    Promise.resolve()
      .then(() => handler(msg.args, ctx))
      .then((result) => {
        if (ac.signal.aborted) return
        // 二进制转发约定：handler 返回 { data: ArrayBuffer, result } 时，data 随消息转发、result 进信封。
        // 仅当 data 真的是 ArrayBuffer 才走 result 分支 —— 否则会把普通信封（含 data 字段的
        // { code, data, from }，如 rpc.success(x) / rpc.error(code, msg) 的返回值）误判为二进制包装，
        // 取 result.result 得 undefined，导致 data 丢失（成功变空数据、失败码被吞成成功）。
        const forwarded = (result as { data?: unknown } | null | undefined)?.data
        const data = forwarded instanceof ArrayBuffer ? forwarded : undefined
        const raw = data !== undefined ? (result as { result?: unknown }).result : result
        // 信封归一（契约点 1）：handler 已返回信封则原样透传，否则包成 { code: 0, data, from }
        const value = isEnvelope(raw) ? raw : toSuccessEnvelope(raw)
        sendDirect(
          isStream
            ? { type: 'stream-done', request_id: msg.request_id, result: value }
            : { type: 'response', request_id: msg.request_id, result: value, data },
        )
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        const error = err instanceof Error ? err.message : String(err)
        const error_code = extractErrorCode(err) ?? WorkerErrorCode.THROW_ERROR
        // handler throw 兜底（契约点 2）：包装为失败信封，不 reject 渲染层 Promise
        const result = toFailureEnvelope(error_code, extractErrorMsg(err))
        if (isStream) {
          sendDirect({ type: 'stream-error', request_id: msg.request_id, error, error_code })
        } else {
          sendDirect({ type: 'error', request_id: msg.request_id, error, error_code, result })
        }
      })
      .finally(() => {
        inFlight.delete(msg.request_id)
      })
  }

  if (ctl) {
    // 主进程最近一次有消息的时间（心跳 / rpc-call / host-api-response 等均代表主进程存活）
    let lastSeenAt = Date.now()

    ctl.on('message', (event: unknown) => {
      const e = event as { data: PluginMessage; ports?: unknown[] }
      const msg = e.data
      lastSeenAt = Date.now()
      switch (msg.type) {
        case 'init': {
          // 宿主下发的 instanceKey（dev 实例 = '<id>@dev'）作为运行标识，覆盖插件写死的逻辑 id
          if (msg.pluginId) activePluginId = msg.pluginId
          sendMessage({ type: 'ready', pluginId: activePluginId, capabilities: Array.from(handlers.keys()) })
          // 控制面就绪（纯 worker 无 directPort 场景，init 后即就绪）→ 触发 onReady
          fireReady()
          break
        }
        case 'port-setup': {
          // 独立进程模式：主进程下发直连 port → 复用 setupDirectPort（池模式经 load-plugin 直接注入）
          const [port] = (e.ports ?? []) as RpcChannel[]
          if (port) setupDirectPort(port)
          break
        }
        case 'rpc-call':
          handleRpcCall(msg as never)
          break
        case 'host-api-response':
          handleHostApiResponse(msg as HostApiResponseMessage)
          break
        case 'child-control-response':
          handleChildControlResponse(msg as ChildControlResponseMessage)
          break
        case 'child-event': {
          // 宿主代管子进程事件（child.spawn 流式输出/退出）：按 handleId 分发到 ChildHandle 回调
          const ev = msg as {
            child?: { handleId?: string; event?: string; data?: string; code?: number | null; signal?: string | null }
          }
          const h = ev.child
          const handleId = h?.handleId
          if (!handleId) break
          const l = childEventListeners.get(handleId)
          if (!l) break
          if (h.event === 'stdout') l.onStdout?.(h.data ?? '')
          else if (h.event === 'stderr') l.onStderr?.(h.data ?? '')
          else if (h.event === 'exit') l.onExit?.({ code: h.code ?? null, signal: h.signal ?? undefined, reason: 'exited' })
          else if (h.event === 'error') l.onError?.(new Error(h.data ?? 'spawn error'))
          break
        }
        case 'notification-event': {
          // 宿主回推的通知句柄事件（notification.send 句柄的 click/close/reply/action/failed/show）
          const ev = msg as NotificationEventMessage
          const rec = notificationHandles.get(ev.id)
          if (!rec) break
          const cbs = rec.events.get(ev.event)
          if (!cbs) break
          for (const cb of Array.from(cbs)) {
            try {
              cb(ev.payload)
            } catch (err) {
              console.error(`[plugin:${activePluginId}] notification "${ev.event}" handler error:`, err)
            }
          }
          break
        }
        case 'snapshot-request': {
          // 主进程重启前请求快照：1s 窗口内回 snapshot-response；未注册 handler 则静默不回
          const req = msg as SnapshotRequestMessage
          if (snapshotHandler) {
            Promise.resolve()
              .then(() => snapshotHandler!())
              .then((snapshot) => {
                const res: SnapshotResponseMessage = { type: 'snapshot-response', pluginId: activePluginId, request_id: req.request_id, snapshot }
                sendMessage(res)
              })
              .catch((err) => {
                const res: SnapshotResponseMessage = {
                  type: 'snapshot-response',
                  pluginId: activePluginId,
                  request_id: req.request_id,
                  error: err instanceof Error ? err.message : String(err),
                }
                sendMessage(res)
              })
          }
          break
        }
        case 'snapshot-restore': {
          // 重启后主进程回灌快照（消息保序：先于后续 rpc-call 到达）
          const res = msg as SnapshotRestoreMessage
          if (restoreHandler) {
            void Promise.resolve()
              .then(() => restoreHandler!(res.snapshot))
              .catch((err) => console.error(`[plugin:${pluginId}] snapshot restore failed:`, err))
          }
          break
        }
        case 'heartbeat':
          // 主进程存活信号：仅刷新 lastSeenAt（已在开头统一处理）
          break
        case 'dispose': {
          // 宿主停止前：先逆序执行 onDispose 回调（可 Promise 等待），再逆序执行 effect disposers，
          // 完成后回复 dispose-done（生命周期 12.3.5-④，对齐 cordis dispose）
          const run = async () => {
            for (let i = onDisposeCallbacks.length - 1; i >= 0; i--) {
              try {
                await onDisposeCallbacks[i]()
              } catch (err) {
                console.error(`[plugin:${activePluginId}] onDispose "${i}" failed:`, err)
              }
            }
            onDisposeCallbacks.length = 0
            for (let i = disposers.length - 1; i >= 0; i--) {
              try {
                await disposers[i]()
              } catch (err) {
                console.error(`[plugin:${activePluginId}] dispose "${i}" failed:`, err)
              }
            }
            disposers.length = 0
            sendMessage({ type: 'dispose-done', pluginId: activePluginId })
          }
          void run()
          break
        }
      }
    })
    // 池模式：ctl 是注入的 MessagePortMain，必须显式 start() 才会开始接收消息
    //（独立进程模式为 process.parentPort，无 start 方法，可选链安全跳过）。
    // 缺少 start 时 worker 收不到主进程 heartbeat / host-api-response → watchdog 误报
    // 「Main process lost (no message for 30s)」，所有 host-api 调用与渲染层请求全部超时。
    ctl.start?.()

    // worker → 主进程心跳：每 10s 上报一次，主进程据此判定 worker 是否失联
    setInterval(() => {
      sendMessage({ type: 'heartbeat', pluginId: activePluginId, ts: Date.now() })
    }, 10000)

    // worker 侧失联 watchdog：主进程心跳每 10s 一条，超过 30s 未收到任何消息
    setInterval(() => {
      if (Date.now() - lastSeenAt > 30000) {
        const error = new Error('Main process lost (no message for 30s)')
        for (const { reject } of pending.values()) reject(error)
        pending.clear()
      }
    }, 5000)
  }

  const handleRpcCall = (msg: { id: string; method: string; args: unknown[]; from_plugin_id?: string }) => {
    const handler = handlers.get(msg.method)
    const response: RpcResponseMessage = { type: 'rpc-response', id: msg.id, pluginId: activePluginId }
    if (!handler) {
      response.error = `Method "${msg.method}" not found`
      response.error_code = WorkerErrorCode.METHOD_NOT_REGISTERED
    } else {
      // 跨插件调用（主进程 plugin.invoke 转发）携带 from_plugin_id：handler 经 ctx 识别请求方，
      // 用于多租户隔离（如 sqlite 插件按调用方建库）；渲染层直连不经过此通道（见 runDirectHandler）。
      const ctx: HandlerContext = {
        from_plugin_id: msg.from_plugin_id ?? '',
        request_id: msg.id,
        signal: new AbortController().signal,
      }
      try {
        const result = handler(msg.args, ctx)
        if (result instanceof Promise) {
          result.then(
            (value) => { response.result = value; sendMessage(response) },
            (err) => { response.error = err.message; response.error_code = extractErrorCode(err) ?? WorkerErrorCode.INTERNAL; sendMessage(response) },
          )
          return
        }
        response.result = result
      } catch (err) {
        response.error = err instanceof Error ? err.message : String(err)
        response.error_code = extractErrorCode(err) ?? WorkerErrorCode.INTERNAL
      }
    }
    sendMessage(response)
  }

  const handleHostApiResponse = (msg: HostApiResponseMessage) => {
    const pendingItem = pending.get(msg.id)
    if (pendingItem) {
      pending.delete(msg.id)
      if (msg.error) {
        pendingItem.reject(codedError(msg.error_code ?? WorkerErrorCode.INTERNAL, msg.error))
      } else {
        pendingItem.resolve(msg.result)
      }
    }
  }

  // ---- child 句柄内聚通道（worker → 宿主 child-control / child-subscribe；替代原 child.kill/readOutput/writeStdin/stdinEnd host-api）----
  const childCtlPending = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()
  let childCtlSeq = 0

  const handleChildControlResponse = (msg: ChildControlResponseMessage) => {
    const pendingItem = childCtlPending.get(msg.id)
    if (!pendingItem) return
    childCtlPending.delete(msg.id)
    if (!msg.ok) pendingItem.reject(new Error(msg.reason ?? 'child control failed'))
    else pendingItem.resolve()
  }

  /** 订阅句柄事件：注册回调后立即调用（宿主回放缓冲事件，之后实时流推送） */
  const sendChildSubscribe = (handleId: string): void => {
    const msg: ChildSubscribeMessage = { type: 'child-subscribe', pluginId: activePluginId, handleId }
    sendMessage(msg)
  }

  /** child 句柄控制：kill=树杀+注销；write=写 stdin；end=结束 stdin（定向到句柄属主，宿主校验 owner） */
  const callChildControl = (handleId: string, op: 'kill' | 'write' | 'end', data?: string): Promise<void> => {
    const id = `child-ctl-${activePluginId}-${++childCtlSeq}`
    const msg: ChildControlMessage = { type: 'child-control', id, pluginId: activePluginId, handleId, op, data }
    return new Promise<void>((resolve, reject) => {
      childCtlPending.set(id, { resolve, reject })
      sendMessage(msg)
    })
  }

  // webview 能力不再经 worker 转发：<Webview>（@dlient-open/ui）由 PluginView 注入「绑定本视图」的
  // 客户端，经 window.dlient.webview.* 直连 preload → 主进程 webview-manager（webview-ipc.ts）。
  // webContents 事件同理由主进程按创建者视图推送 'webview:event'，不再经 onWebContentsEvent 中转。

  // rpc.xx.xx 宿主能力模块树：叶子函数 = callHostApiImpl（child 由下方 SDK 特型实现，不入树）
  const hostModules = createHostApiModules((method, args) => callHostApiImpl(method, args))

  return {
    ...hostModules,
    child: {
      /** 宿主代 spawn（child.spawn）：句柄内聚，SDK 自动完成 child-subscribe 订阅/回放 */
      spawn: async (options: SpawnHostedOptions): Promise<ChildHandle> => {
        const res = (await callHostApiImpl('child.spawn', [{ ...options }])) as { handleId?: string; pid?: number }
        const handleId = String(res?.handleId ?? '')
        if (!handleId) throw new Error('child.spawn: handleId missing')
        return createChildHandle(handleId, typeof res?.pid === 'number' ? res.pid : 0)
      },
      /** 宿主代 execFile（child.execFile）：一次性捕获输出，不产生句柄 */
      execFile: (options: SpawnHostedOptions & { timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }> =>
        callHostApiImpl('child.execFile', [{ ...options }]) as Promise<{ stdout: string; stderr: string; code: number }>,
    },
    // rpc.notification：SDK 特型（send 返回句柄 + 自动订阅宿主事件；child 同款句柄内聚模式）
    notification: {
      isSupported: async () => Boolean(await callHostApiImpl('notification.isSupported', [])),
      send: (options: NotificationSendOptions) => createNotificationHandleFromSend(options),
      remove: async (id) => {
        await callHostApiImpl('notification.remove', [String(id)])
      },
      removeGroup: async () => {
        await callHostApiImpl('notification.removeGroup', [])
      },
      subscribe: async (options) => {
        await callHostApiImpl('notification.subscribe', [options])
      },
      unsubscribe: async (options) => {
        await callHostApiImpl('notification.unsubscribe', [options])
      },
    },
    getPluginId: () => activePluginId,

    registerHandler: (method: string, handler: WorkerRpcHandler) => {
      handlers.set(method, handler)
      streamHandlers.delete(method)
    },

    registerSnapshotHandler: (handler: () => unknown | Promise<unknown>) => {
      snapshotHandler = handler
    },

    registerRestoreHandler: (handler: (snapshot: unknown) => void | Promise<void>) => {
      restoreHandler = handler
    },

    effect: (install: () => unknown | Promise<unknown> | void | Promise<void>) => {
      // install() 返回 disposer；异常时记录并跳过（副作用注册失败不阻塞插件启动）
      let registered = false
      let disposer: (() => unknown) | undefined
      try {
        const result = install()
        if (result instanceof Promise) {
          void result
            .then((d) => {
              if (typeof d === 'function') {
                disposer = d as () => unknown
                disposers.push(disposer)
                registered = true
              }
            })
            .catch((err) => console.error(`[plugin:${activePluginId}] effect install failed:`, err))
        } else if (typeof result === 'function') {
          disposer = result as () => unknown
          disposers.push(disposer)
          registered = true
        }
      } catch (err) {
        console.error(`[plugin:${activePluginId}] effect install failed:`, err)
      }
      // 同步已注册则返回可提前撤销的 disposer；异步场景由宿主 stop 时统一逆序执行
      return registered ? disposer : undefined
    },

    onReady: (cb: () => void) => {
      // 注册就绪回调；已就绪则立即触发（避免回调注册晚于就绪事件而丢失）
      onReadyCallbacks.push(cb)
      if (readyFired) {
        try {
          cb()
        } catch (err) {
          console.error(`[plugin:${activePluginId}] onReady failed:`, err)
        }
      }
    },

    onDispose: (cb: () => unknown | Promise<unknown>) => {
      onDisposeCallbacks.push(cb)
    },

    registerStreamHandler: (method: string, handler: WorkerRpcHandler) => {
      handlers.set(method, handler)
      streamHandlers.add(method)
    },

    push: (event: string, data?: unknown) => {
      const msg: PushMessage = { type: 'push', pluginId: activePluginId, event, data }
      sendMessage(msg)
    },

    registerChildEvent: (handleId: string, handlers: ChildEventHandlers) => {
      childEventListeners.set(handleId, handlers)
    },
    unregisterChildEvent: (handleId: string) => {
      childEventListeners.delete(handleId)
    },
    childSubscribe: (handleId: string) => sendChildSubscribe(handleId),
    childControl: (handleId: string, op: 'kill' | 'write' | 'end', data?: string) => callChildControl(handleId, op, data),

    success: <T>(data?: T): ApiResponse<T> => toSuccessEnvelope(data),

    error: (code: number, msg?: ResponseErrorMsg): ApiResponse<null> => toFailureEnvelope(code, msg),

    createNativeHost: async (
      fileName: string,
      opts?: { maxRestarts?: number; backoffMs?: number; maxBackoffMs?: number },
    ): Promise<CreateNativeHostResult> => {
      // 1. 官方 node 运行时：内置 nodejs host-api（nodejs.resolveRuntime；内置/本地均无 → error）
      //    开源版宿主不再有 nodejs 插件：插件声明 manifest.permissions 的 nodejs.resolveRuntime 即可直连。
      let node = ''
      try {
        const rt = (await callHostApiImpl('nodejs.resolveRuntime', [])) as { node?: string }
        node = typeof rt?.node === 'string' ? rt.node : ''
      } catch {
        /* 未授权 nodejs.resolveRuntime，或内置/本地运行时均不可用 */
      }
      if (!node) return { host: null, client: null, error: 'createNativeHost: nodejs runtime unavailable' }
      // 2. 宿主按 fileName 在插件 dist 查找并代 spawn 官方 Node
      let spawnRes: { handleId?: string; pid?: number } = {}
      try {
        spawnRes = (await callHostApiImpl('app.createNativeHost', [{ fileName: String(fileName), node }])) as {
          handleId?: string
          pid?: number
        }
      } catch (err) {
        return { host: null, client: null, error: err instanceof Error ? err.message : String(err) }
      }
      const handleId = String(spawnRes?.handleId ?? '')
      if (!handleId) return { host: null, client: null, error: 'createNativeHost: no handle' }
      // 3. 宿主代管句柄 → native-host client
      const handle = createChildHandle(handleId, typeof spawnRes?.pid === 'number' ? spawnRes.pid : 0)
      let client: NativeHostClient
      try {
        client = createNativeHostClient({ transport: createHostedTransport(handle) })
      } catch (err) {
        return { host: null, client: null, error: err instanceof Error ? err.message : String(err) }
      }
      // 4. 崩溃自动重启 host（onRestarted：每次重启后触发注册的恢复回调）
      const restartCbs: Array<() => void> = []
      const hostBase = createRestartableNativeHost({
        spawn: async () => ({ client, dispose: () => void handle.kill() }),
        onRestarted: async () => {
          for (const cb of restartCbs) {
            try {
              cb()
            } catch {
              /* 忽略恢复回调异常 */
            }
          }
        },
        maxRestarts: opts?.maxRestarts,
        backoffMs: opts?.backoffMs,
        maxBackoffMs: opts?.maxBackoffMs,
      })
      const host = Object.assign(hostBase, { onRestarted: (cb: () => void) => void restartCbs.push(cb) })
      return { host, client, error: undefined }
    },
  }

  /** 宿主代管句柄构造（child-event 分发 + stdin/退出；rpc.child.spawn / createNativeHost 共用）。
   *  句柄内聚：注册回调后立即 child-subscribe（宿主回放缓冲事件，之后实时流），消除 spawn 返回前的事件注册竞态。 */
  function createChildHandle(handleId: string, pid: number): ChildHandle {
    const listeners: ChildEventHandlers = {}
    childEventListeners.set(handleId, listeners)
    sendChildSubscribe(handleId)
    return {
      handleId,
      pid,
      kill: () => {
        childEventListeners.delete(handleId)
        return callChildControl(handleId, 'kill')
      },
      onStdout: (cb) => {
        listeners.onStdout = cb
      },
      onStderr: (cb) => {
        listeners.onStderr = cb
      },
      onExit: (cb) => {
        listeners.onExit = cb
      },
      onError: (cb) => {
        listeners.onError = cb
      },
      write: (chunk: string) => callChildControl(handleId, 'write', chunk),
      end: () => callChildControl(handleId, 'end'),
    }
  }

  /** notification 句柄构造（send → {id} → 建句柄 + 自动 subscribe；宿主 send 时已记账并缓冲事件，subscribe 回放消除竞态） */
  async function createNotificationHandleFromSend(options: NotificationSendOptions): Promise<NotificationHandle> {
    const res = (await callHostApiImpl('notification.send', [options])) as { id?: string }
    const id = String(res?.id ?? '')
    if (!id) throw new Error('notification.send: id missing')
    return createNotificationHandle(id)
  }

  /** 本地句柄：on() 注册回调（notification-event 按 id 分发），close() → notification.remove(id) */
  function createNotificationHandle(id: string): NotificationHandle {
    const events = new Map<string, Array<(payload?: NotificationEventPayload) => void>>()
    notificationHandles.set(id, { events })
    const handle: NotificationHandle = {
      id,
      on(event, cb) {
        const list = events.get(event) ?? []
        list.push(cb)
        events.set(event, list)
        return handle
      },
      close: async () => {
        notificationHandles.delete(id)
        await callHostApiImpl('notification.remove', [id])
      },
    }
    void callHostApiImpl('notification.subscribe', [{ id }]).catch(() => undefined)
    return handle
  }

  function callHostApiImpl(method: string, args: unknown[]): Promise<unknown> {
    const id = `host-api-${activePluginId}-${++messageId}`
    const msg: HostApiCallMessage = { type: 'host-api-call', id, method, args, pluginId: activePluginId }
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      sendMessage(msg)
    })
  }
}
