/**
 * WorkerRpcClient - 主进程 ⇄ worker（utilityProcess）控制面 RPC。
 * 渲染层不直连：请求经主进程 bridge 转成 rpc-call，worker 推送经 push 消息转发。
 */

import type {
  RpcCallMessage,
  RpcResponseMessage,
  PluginMessage,
  HostApiCallMessage,
  HostApiResponseMessage,
  PushMessage,
  SnapshotRequestMessage,
  SnapshotResponseMessage,
  SnapshotRestoreMessage,
  DisposeMessage,
} from '@dlient-open/plugin-sdk'
import { DlientErrorCode, getErrorCode } from './errors'

type RpcHandler = (args: unknown[]) => unknown | Promise<unknown>
type HostApiExecutor = (method: string, args: unknown[]) => unknown | Promise<unknown>

/**
 * child 控制消息（句柄内聚：worker → 宿主 child.spawn 句柄 kill/stdin 操作）。
 * 与 @dlient-open/plugin-sdk 的 protocol.ts 同构（SDK 未发版前 core 自持一份，发版后收敛为 SDK 类型）。
 */
interface ChildControlMessageLocal {
  type: 'child-control'
  id: string
  pluginId: string
  handleId: string
  op: 'kill' | 'write' | 'end'
  data?: string
}
interface ChildControlResponseMessageLocal {
  type: 'child-control-response'
  id: string
  ok: boolean
  reason?: string
}
interface ChildSubscribeMessageLocal {
  type: 'child-subscribe'
  pluginId: string
  handleId: string
}
/** 宿主侧接收消息全集（SDK PluginMessage + child 控制/订阅） */
type HostBoundMessage = PluginMessage | ChildControlMessageLocal | ChildSubscribeMessageLocal

/** worker 心跳间隔（worker 侧 setInterval 发心跳的周期） */
const HEARTBEAT_INTERVAL_MS = 10000
/** 超过该时长未收到 worker 任何消息 → 判定 worker 失联 */
const HEARTBEAT_LOST_THRESHOLD_MS = 30000
/** watchdog 检查周期 */
const WATCHDOG_CHECK_MS = 5000
/** 快照请求超时（重启前等待 worker 快照的时间窗口，与用户约定的 1s 一致） */
const SNAPSHOT_TIMEOUT_MS = 1000

/** 兼容 DOM MessagePort 与 Electron MessagePortMain / utilityProcess 包装 */
export interface MessagePortLike {
  /** transfer：Electron 主进程为 MessagePortMain[]（下发直连 port），worker 侧为 ArrayBuffer[]（大块数据） */
  postMessage(message: unknown, transfer?: unknown[]): void
  on(event: string, callback: (...args: unknown[]) => void): void
  start(): void
  close(): void
}

export class WorkerRpcClient {
  private handlers = new Map<string, RpcHandler>()
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()
  private messagePort?: MessagePortLike
  private pluginId: string
  private generation: number
  private messageId = 0
  /** 最近一次收到 worker 消息的时间（心跳 / 响应 / 推送等均代表 worker 存活） */
  private lastSeenAt = Date.now()
  /** 快照请求回执（request_id → 回调；1s 超时清理） */
  private snapshotPending = new Map<string, (res: { snapshot?: unknown; error?: string }) => void>()
  /** dispose-done 等待回调（sendDispose 置入，worker 回复后解除） */
  private disposePending?: () => void
  /** 失联 watchdog（单例：存在 pending 调用时启动） */
  private watchdogTimer?: ReturnType<typeof setInterval>
  /** 主进程 → worker 心跳定时器（worker 侧据此判定主进程存活；常驻，不依赖 pending） */
  private mainHeartbeatTimer?: ReturnType<typeof setInterval>

  /** 宿主能力执行器（主进程注入，executeHostApi 授权后执行） */
  onHostApiCall?: HostApiExecutor
  /** child 句柄控制执行器（主进程注入；child.spawn 句柄 kill/stdin，句柄内聚通道，不经 host-api） */
  onChildControl?: (handleId: string, op: 'kill' | 'write' | 'end', data?: string) => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string }
  /** child 句柄事件订阅执行器（主进程注入；child-subscribe 后回放缓冲事件 + 实时流） */
  onChildSubscribe?: (handleId: string) => void
  /** worker 设置好 directPort 后回调（plugin-controller 据此把 port1 交上层分发渲染层） */
  onDirectPortReady?: (pluginId: string) => void
  /** worker 推送回调列表（多订阅者共存：bridge 分发渲染层 + 主进程广播等） */
  private onPushCallbacks: Array<(event: string, data: unknown) => void> = []

  constructor(pluginId: string, generation: number) {
    this.pluginId = pluginId
    this.generation = generation
  }

  /** 注册 worker 推送回调（可多次注册，全部生效；bridge 渲染层分发 / 主进程广播等共存） */
  onPush(callback: (event: string, data: unknown) => void): void {
    this.onPushCallbacks.push(callback)
  }

  setMessagePort(port: MessagePortLike): void {
    this.messagePort = port
    port.on('message', (event: unknown) => {
      const msg = (event as { data: HostBoundMessage }).data
      this.handleMessage(msg)
    })
    port.start()

    // 主进程 → worker 心跳：每 10s 一次，worker 侧据此判定主进程存活
    // （worker 侧已不再使用固定超时，改由心跳 watchdog 判定主进程失联）
    this.mainHeartbeatTimer = setInterval(() => {
      this.messagePort?.postMessage({ type: 'heartbeat', pluginId: this.pluginId, ts: Date.now() })
    }, HEARTBEAT_INTERVAL_MS)
  }

  registerHandler(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler)
  }

  async call<T = unknown>(method: string, args: unknown[] = [], fromPluginId?: string): Promise<T> {
    if (!this.messagePort) {
      throw new Error('Message port not set')
    }
    const id = `rpc-${this.pluginId}-${this.generation}-${++this.messageId}`
    const msg: RpcCallMessage = {
      type: 'rpc-call',
      id,
      method,
      args,
      pluginId: this.pluginId,
      // 跨插件调用来源（plugin.invoke 时主进程填入调用方 id，供目标 worker 多租户隔离）
      from_plugin_id: fromPluginId,
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.messagePort!.postMessage(msg)
      // 不设固定超时：worker 有心跳（10s 一次）即视为存活，长任务可持续等待；
      // 失联判定由 watchdog 完成（超过 HEARTBEAT_LOST_THRESHOLD_MS 未收到任何消息）
      this.ensureWatchdog()
    })
  }

  /**
   * 请求业务状态快照（重启前）：worker 侧未注册快照 handler 或 1s 内无响应 → 返回 undefined（按无快照处理）。
   */
  async requestSnapshot(): Promise<{ snapshot?: unknown; error?: string } | undefined> {
    const port = this.messagePort
    if (!port) return undefined
    const id = `snap-${this.pluginId}-${this.generation}-${++this.messageId}`
    const msg: SnapshotRequestMessage = { type: 'snapshot-request', pluginId: this.pluginId, request_id: id }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.snapshotPending.delete(id)
        resolve(undefined)
      }, SNAPSHOT_TIMEOUT_MS)
      this.snapshotPending.set(id, (res) => {
        clearTimeout(timer)
        this.snapshotPending.delete(id)
        resolve(res)
      })
      port.postMessage(msg)
    })
  }

  /** 恢复业务状态快照（重启后新 worker 回灌；消息保序，先于后续调用到达） */
  restoreSnapshot(snapshot: unknown): void {
    if (!this.messagePort) return
    const msg: SnapshotRestoreMessage = { type: 'snapshot-restore', pluginId: this.pluginId, snapshot }
    this.messagePort.postMessage(msg)
  }

  /** 向 worker 推送任意控制面消息（宿主主动事件，如 child-event 流式输出/退出推送） */
  sendControlMessage(message: unknown): void {
    if (!this.messagePort) return
    this.messagePort.postMessage(message)
  }

  /** 请求 worker 逆序执行 rpc.effect disposables（停止前优雅清理）；超时兜底（worker 已死/无响应不阻塞 stop） */
  sendDispose(timeoutMs = 2000): Promise<void> {
    if (!this.messagePort) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.disposePending = undefined
        resolve()
      }, timeoutMs)
      this.disposePending = () => {
        clearTimeout(timer)
        this.disposePending = undefined
        resolve()
      }
      const msg: DisposeMessage = { type: 'dispose', pluginId: this.pluginId }
      this.messagePort!.postMessage(msg)
    })
  }

  private handleMessage(msg: HostBoundMessage): void {
    // 任何 worker 消息（心跳 / 响应 / 推送 / 日志）都代表 worker 存活
    this.lastSeenAt = Date.now()
    switch (msg.type) {
      case 'rpc-response':
        this.handleRpcResponse(msg)
        break
      case 'rpc-call':
        this.handleRpcCall(msg)
        break
      case 'host-api-call':
        this.handleHostApiCall(msg)
        break
      case 'child-control':
        this.handleChildControl(msg)
        break
      case 'child-subscribe':
        this.onChildSubscribe?.(msg.handleId)
        break
      case 'push':
        this.handlePush(msg)
        break
      case 'direct-port-ready':
        // worker 已设置 directPort 监听 → 通知 controller 把 port1 交上层分发渲染层
        this.onDirectPortReady?.(msg.pluginId)
        break
      case 'heartbeat':
        // 存活信号：仅刷新 lastSeenAt（已在开头统一处理），无需其他动作
        break
      case 'error':
        console.error(`[WorkerRpc] Plugin ${this.pluginId} error:`, msg.message)
        break
      case 'snapshot-response':
        this.handleSnapshotResponse(msg)
        break
      case 'dispose-done':
        // worker 已完成 rpc.effect disposables 清理 → 解除宿主 stop 等待
        this.disposePending?.()
        this.disposePending = undefined
        break
    }
  }

  private handleSnapshotResponse(msg: SnapshotResponseMessage): void {
    const cb = this.snapshotPending.get(msg.request_id)
    if (cb) {
      cb({ snapshot: msg.snapshot, error: msg.error })
    }
  }

  /** 失联 watchdog：周期性检查，超过阈值未收到消息 → 判定 worker 失联，终止其全部 pending 调用 */
  private ensureWatchdog(): void {
    if (this.watchdogTimer) return
    this.watchdogTimer = setInterval(() => {
      const silentMs = Date.now() - this.lastSeenAt
      if (silentMs > HEARTBEAT_LOST_THRESHOLD_MS) {
        const error = new Error(
          `Worker "${this.pluginId}" lost (no message for ${Math.round(silentMs / 1000)}s, ` +
          `heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s)`,
        )
        for (const { reject } of this.pending.values()) reject(error)
        this.pending.clear()
        this.stopWatchdog()
      }
    }, WATCHDOG_CHECK_MS)
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = undefined
    }
  }

  private handleRpcResponse(msg: RpcResponseMessage): void {
    const pending = this.pending.get(msg.id)
    if (pending) {
      this.pending.delete(msg.id)
      if (msg.error) {
        const e = new Error(msg.error)
        ;(e as Error & { code?: number }).code = msg.error_code ?? getErrorCode(msg.error)
        pending.reject(e)
      } else {
        pending.resolve(msg.result)
      }
    }
  }

  private handleRpcCall(msg: RpcCallMessage): void {
    const handler = this.handlers.get(msg.method)
    const response: RpcResponseMessage = { type: 'rpc-response', id: msg.id, pluginId: this.pluginId }
    if (!handler) {
      response.error = `Method "${msg.method}" not found`
      response.error_code = DlientErrorCode.METHOD_NOT_REGISTERED
    } else {
      try {
        const result = handler(msg.args)
        if (result instanceof Promise) {
          result.then(
            (value) => { response.result = value; this.messagePort?.postMessage(response) },
            (err) => { response.error = err.message; response.error_code = getErrorCode(err); this.messagePort?.postMessage(response) },
          )
          return
        }
        response.result = result
      } catch (err) {
        response.error = err instanceof Error ? err.message : String(err)
        response.error_code = getErrorCode(err)
      }
    }
    this.messagePort?.postMessage(response)
  }

  private handleHostApiCall(msg: HostApiCallMessage): void {
    const response: HostApiResponseMessage = { type: 'host-api-response', id: msg.id }
    const executor = this.onHostApiCall
    if (!executor) {
      response.error = 'host api executor not configured'
      response.error_code = DlientErrorCode.INTERNAL
      this.messagePort?.postMessage(response)
      return
    }
    Promise.resolve()
      .then(() => executor(msg.method, msg.args ?? []))
      .then((result) => {
        response.result = result
        this.messagePort?.postMessage(response)
      })
      .catch((err) => {
        response.error = err instanceof Error ? err.message : String(err)
        response.error_code = getErrorCode(err)
        this.messagePort?.postMessage(response)
      })
  }

  /** child 句柄控制（句柄内聚：worker → 宿主 kill/stdin；回复 child-control-response） */
  private handleChildControl(msg: ChildControlMessageLocal): void {
    const respond = (res?: { ok?: boolean; reason?: string }) => {
      const response: ChildControlResponseMessageLocal = { type: 'child-control-response', id: msg.id, ok: res?.ok === true, reason: res?.reason }
      this.messagePort?.postMessage(response)
    }
    const exec = this.onChildControl
    if (!exec) {
      respond({ ok: false, reason: 'child control handler not configured' })
      return
    }
    Promise.resolve()
      .then(() => exec(msg.handleId, msg.op, msg.data))
      .then(respond)
      .catch((err) => respond({ ok: false, reason: err instanceof Error ? err.message : String(err) }))
  }

  private handlePush(msg: PushMessage): void {
    for (const callback of this.onPushCallbacks) {
      try {
        callback(msg.event, msg.data)
      } catch (err) {
        console.error(`[rpc:${this.pluginId}] push callback error:`, err)
      }
    }
  }

  dispose(): void {
    this.stopWatchdog()
    if (this.mainHeartbeatTimer) {
      clearInterval(this.mainHeartbeatTimer)
      this.mainHeartbeatTimer = undefined
    }
    this.pending.forEach(({ reject }) => reject(new Error('WorkerRpcClient disposed')))
    this.pending.clear()
    this.handlers.clear()
    if (this.messagePort) {
      this.messagePort.close()
      this.messagePort = undefined
    }
  }
}
