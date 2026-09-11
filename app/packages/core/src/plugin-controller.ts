/**
 * PluginController - 单插件生命周期（加载 / 监控 / 控制面）。
 * 执行面：统一经共享 worker 池（PoolManager → pool-worker.js import 插件 worker.js）；
 * 独立进程模式已移除。控制面 RPC 经 MessageChannelMain（ctl1/ctl2）。
 * 直连：创建 MessageChannelMain，direct2 transfer 进池（load-plugin），
 *       worker 设置好 directPort 回 direct-port-ready 后，port1 交上层分发渲染层（preload port 表）。
 */

import { MessageChannelMain, type MessagePortMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginManifest, PluginRuntime, PluginType } from '@dlient-open/plugin-sdk'
import { WorkerRpcClient, type MessagePortLike } from './worker-rpc'
import type { PluginPool } from './pool-manager'
import { instanceKeyFor, type InstanceKey } from './instance'
import { DlientError, DlientErrorCode } from './errors'
import { logger } from './logger'

export interface PluginControllerOptions {
  manifest: PluginManifest
  pluginPath: string
  /** 宿主能力执行器：授权校验后执行 worker 发起的 host-api 调用 */
  hostApiExecutor?: (pluginId: string, method: string, args: unknown[]) => Promise<unknown>
  /** child 句柄控制（child.spawn 句柄内聚：worker→宿主 child-control 消息；owner=instanceKey） */
  childControlHandler?: (pluginId: string, handleId: string, op: 'kill' | 'write' | 'end', data?: string) => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string }
  /** child 句柄事件订阅（child.spawn：child-subscribe 后宿主回放缓冲事件 + 实时流） */
  childSubscribeHandler?: (pluginId: string, handleId: string) => void
  /** 共享 worker 池（池化运行）。solo 插件由 poolKeyFor 分入 solo 池；所有插件统一走池，无独立进程模式。 */
  pool: PluginPool
}

export class PluginController {
  public readonly pluginId: string
  /** 实例键（隔离键）：正式 = pluginId，dev = pluginId@dev */
  public readonly instanceKey: InstanceKey
  public readonly pluginType: PluginType
  private manifest: PluginManifest
  private pluginPath: string
  private rpcClient?: WorkerRpcClient
  private onStatusChange?: (runtime: PluginRuntime) => void
  private onError?: (error: Error) => void
  private hostApiExecutor?: (pluginId: string, method: string, args: unknown[]) => Promise<unknown>
  private childControlHandler?: PluginControllerOptions['childControlHandler']
  private childSubscribeHandler?: PluginControllerOptions['childSubscribeHandler']
  /** 直连 port1（MessagePortMain，待 worker 就绪后交上层分发渲染层） */
  private directPort1?: MessagePortMain
  /** 最近一次已交付上层的 port1 实例：MessagePortMain 一经 webContents.postMessage transfer 即 neutered，
   *  同一实例重复交付（worker 对每次 port-setup 都回 direct-port-ready，refresh 竞态下可能重入）会导致
   *  「Port at index 0 is already registered」，故同实例只交付一次。 */
  private lastDeliveredPort?: MessagePortMain
  /** 主动 stop 标记：stop() kill 后 exit 事件仍会异步触发，避免重复广播「exit」退出事件 */
  private stoppedByManager = false
  /** 池内 worker 加载失败 / 池退出标记：rpcClient 可能仍存在但 worker 实际不可用，isRunning 据此返回 false */
  private loadFailed = false
  /** 无 worker 产物（ui 类型 / 纯 UI 的 app）：无直连端口，但插件本身视为可用 */
  private workerless = false
  /** 可逆副作用（生命周期 12.3.5-②：宿主侧子进程/订阅等；stop 时逆序执行） */
  private disposables: Array<{ name: string; dispose: () => void | Promise<void> }> = []
  /** worker 设置好 directPort 后回调（instanceKey, port1） */
  private onDirectPortReady?: (instanceKey: InstanceKey, port: MessagePortMain) => void
  /** worker 退出/失联回调（instanceKey, reason） */
  private onExited?: (instanceKey: InstanceKey, reason?: string) => void
  /** 共享 worker 池（池化运行；所有插件统一走池） */
  private readonly pool: PluginPool
  /** 池模式控制面 port1（MessagePortMain，作为 rpcClient 通道） */
  private poolCtl1?: MessagePortMain
  private poolExitUnsub?: () => void
  private poolLoadFailedUnsub?: () => void

  constructor(options: PluginControllerOptions) {
    this.manifest = options.manifest
    this.pluginPath = options.pluginPath
    this.pluginId = options.manifest.id
    this.instanceKey = instanceKeyFor(options.manifest.id, options.manifest.source, true)
    // type 缺省 = 'app'（manifest 规则；宿主内建，不依赖外部 sdk 版本）
    this.pluginType = options.manifest.type ?? 'app'
    this.hostApiExecutor = options.hostApiExecutor
    this.childControlHandler = options.childControlHandler
    this.childSubscribeHandler = options.childSubscribeHandler
    this.pool = options.pool
  }

  get version(): string {
    return this.manifest.version
  }

  /** 实例键（隔离键）：正式 = pluginId，dev = pluginId@dev */
  getInstanceKey(): InstanceKey {
    return this.instanceKey
  }

  /** 注册可逆副作用（宿主侧；worker 停止/卸载时逆序执行，如子进程 kill、订阅取消） */
  registerDisposable(name: string, dispose: () => void | Promise<void>): void {
    this.disposables.push({ name, dispose })
  }

  /** 逆序执行全部 disposables（后注册先清理；单项异常记录不中断其余） */
  private async runDisposables(): Promise<void> {
    for (let i = this.disposables.length - 1; i >= 0; i--) {
      try {
        await this.disposables[i].dispose()
      } catch (err) {
        logger.error(`plugin:${this.instanceKey}`, `disposable "${this.disposables[i].name}" failed`, err)
      }
    }
    this.disposables = []
  }

  /** 池内 worker 是否实际可用（加载失败 / 池退出后 rpcClient 残留，isRunning 据此判断真实运行态） */
  isLoadFailed(): boolean {
    return this.loadFailed
  }

  /** 是否无 worker 产物（ui 类型 / 纯 UI 的 app）。
   *  这类插件不 fork、无直连端口，但 UI 可用 → isRunning/isPortReady 视为就绪，
   *  ENSURE_WORKER 据此快速失败，避免渲染层白等 15s 端口超时。 */
  isWorkerless(): boolean {
    return this.workerless
  }

  /** 直连 port 是否已交付（worker 回 direct-port-ready 后为 true）。
   *  池模式 start() 发完 loadPlugin 立即置 running，但 port-ready 握手是异步的；
   *  调用编排方（dev-runtime ensureRunning/refresh）需同时确认 running 与 port 就绪，避免误报成功。 */
  isDirectPortReady(): boolean {
    return !!this.lastDeliveredPort
  }

  setStatusCallback(callback: (runtime: PluginRuntime) => void): void {
    this.onStatusChange = callback
  }

  setErrorCallback(callback: (error: Error) => void): void {
    this.onError = callback
  }

  /** 启动插件 worker（懒启动、幂等；ui 类型或无 worker.js 产物的插件直接 running） */
  async start(generation: number): Promise<void> {
    // worker 一律从磁盘 <pluginDir>/<dist>/worker.js 读取（已统一普通打包，不再产出/使用 plugin.asar）
    const distEntry = join(this.pluginPath, `${this.manifest.dist ?? 'dist'}/worker.js`)
    const workerEntry = distEntry
    if (this.pluginType === 'ui' || !existsSync(workerEntry)) {
      // 无 worker 产物（ui 类型 / 纯 UI 的 app）：不 fork，直接置 running。
      // workerless 标记供 isRunning/isPortReady/ENSURE_WORKER 判定（渲染层不会等端口）
      this.workerless = true
      this.emitStatus({ id: this.instanceKey, version: this.version, status: 'running', generation, enabled: true })
      return
    }
    this.workerless = false
    logger.info('lifecycle', 'plugin worker fork', {
      pluginId: this.instanceKey,
      pluginPath: this.pluginPath,
      chosen: workerEntry,
    })

    try {
      this.stoppedByManager = false
      this.loadFailed = false
      // 状态机（生命周期 12.3.5-①）：加载前 → starting
      this.emitStatus({ id: this.instanceKey, version: this.version, status: 'starting', generation, enabled: true })
      this.rpcClient = new WorkerRpcClient(this.instanceKey, generation)
      this.rpcClient.onHostApiCall = (method, args) => this.callHostApi(method, args)
      // child 句柄内聚通道（worker → 宿主）：控制（kill/stdin）与事件订阅（回放缓冲 + 实时流）
      this.rpcClient.onChildControl = (handleId, op, data) => this.dispatchChildControl(handleId, op, data)
      this.rpcClient.onChildSubscribe = (handleId) => this.childSubscribeHandler?.(this.instanceKey, handleId)

      // 池模式（唯一运行方式）：控制面 + 直连各一条 MessageChannelMain，port2 transfer 进池。
      // 独立进程模式已移除：所有插件（含 dev / workerMode:solo）统一经 PoolManager 分池，
      // 由 poolKeyFor 决定共享池还是 solo 池（solo 池容量 1，崩溃/阻塞只影响自己）。
      const { port1: ctl1, port2: ctl2 } = new MessageChannelMain()
      const { port1: d1, port2: d2 } = new MessageChannelMain()
      this.poolCtl1 = ctl1
      this.directPort1 = d1
      this.rpcClient.setMessagePort(this.wrapPort(ctl1))
      this.rpcClient.onDirectPortReady = () => {
        if (this.directPort1 && this.directPort1 !== this.lastDeliveredPort) {
          this.lastDeliveredPort = this.directPort1
          this.onDirectPortReady?.(this.instanceKey, this.directPort1)
        }
      }
      // 池退出 = 本插件 worker 退出（清理运行态并广播）
      this.poolExitUnsub = this.pool.onPoolExit((reason) => this.handleExit(reason))
      // 加载失败（worker.js require 抛错）→ 状态 error + 标记 loadFailed（isRunning 据此返回 false，
      // 避免渲染层 ensure-worker 误以为 worker 可用而走 refreshDirectPort 死等 15s）
      this.poolLoadFailedUnsub = this.pool.onLoadFailed((pluginId, error) => {
        if (pluginId !== this.instanceKey) return
        this.loadFailed = true
        this.emitStatus({
          id: this.instanceKey,
          version: this.version,
          status: 'failed',
          generation: 0,
          enabled: false,
          error,
        })
        this.onError?.(new Error(error))
      })
      this.pool.loadPlugin({ pluginId: this.instanceKey, workerEntry, generation, ctl2, direct2: d2 })
      this.emitStatus({
        id: this.instanceKey,
        version: this.version,
        status: 'running',
        generation,
        enabled: true,
        startTime: Date.now(),
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.emitStatus({ id: this.instanceKey, version: this.version, status: 'failed', generation, enabled: false, error: error.message })
      this.onError?.(error)
    }
  }

  /** 停止插件 */
  async stop(): Promise<void> {
    // 状态机（生命周期 12.3.5-①）：停止过渡 → stopping
    this.emitStatus({ id: this.instanceKey, version: this.version, status: 'stopping', generation: 0, enabled: false })
    // 生命周期 12.3.5-③：先请 worker 逆序执行 rpc.effect disposables（优雅清理；2s 超时兜底），
    // 再逆序执行宿主侧 disposables，最后 kill —— 保证「谁注册的副作用谁被清理」。
    if (this.rpcClient) {
      await this.rpcClient.sendDispose()
    }
    await this.runDisposables()
    this.stoppedByManager = true
    this.poolExitUnsub?.()
    this.poolExitUnsub = undefined
    this.poolLoadFailedUnsub?.()
    this.poolLoadFailedUnsub = undefined
    this.pool.unloadPlugin(this.pluginId)
    this.closePoolControl()
    this.closeDirectPort()
    this.emitStatus({ id: this.instanceKey, version: this.version, status: 'stopped', generation: 0, enabled: false })
    this.onExited?.(this.instanceKey, 'stopped')

    if (this.rpcClient) {
      this.rpcClient.dispose()
      this.rpcClient = undefined
    }
  }

  /** 调用宿主能力（授权在 hostApiExecutor 内完成；调用方标识用 instanceKey —— 授权/owner 按实例隔离） */
  private callHostApi(method: string, args: unknown[]): Promise<unknown> {
    if (!this.hostApiExecutor) {
      return Promise.reject(new Error('host api executor not configured'))
    }
    return this.hostApiExecutor(this.instanceKey, method, args)
  }

  /** child 句柄控制（句柄内聚：worker → 宿主 kill/stdin；owner 校验在 childControlHandler 内按 instanceKey 完成） */
  private dispatchChildControl(
    handleId: string,
    op: 'kill' | 'write' | 'end',
    data?: string,
  ): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string } {
    if (!this.childControlHandler) {
      return { ok: false, reason: 'child control handler not configured' }
    }
    return this.childControlHandler(this.instanceKey, handleId, op, data)
  }

  /** 把 MessagePortMain 包装成 MessagePortLike（池模式控制面通道） */
  private wrapPort(port: MessagePortMain): MessagePortLike {
    return {
      postMessage: (message: unknown, transfer?: unknown[]) => {
        // MessagePortMain.postMessage 第二个参数必须为数组（或省略）：无 transfer 时显式传
        // undefined 会抛 "transferables must be an array of MessagePorts"
        if (transfer && transfer.length > 0) port.postMessage(message, transfer as Electron.MessagePortMain[])
        else port.postMessage(message)
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'message') {
          // MessagePortMain 的 message 事件回调参数为 { data, ports }，与 MessagePortLike 兼容
          port.on('message', (eventData: Electron.MessageEvent) => {
            callback({ data: eventData.data, ports: eventData.ports })
          })
        }
      },
      start: () => {
        try {
          port.start()
        } catch {
          /* 已启动忽略 */
        }
      },
      close: () => {
        try {
          port.close()
        } catch {
          /* 已关闭忽略 */
        }
      },
    }
  }

  /** 关闭池模式控制面 port1 */
  private closePoolControl(): void {
    if (this.poolCtl1) {
      try {
        this.poolCtl1.close()
      } catch {
        /* 已关闭忽略 */
      }
      this.poolCtl1 = undefined
    }
  }

  /** 池退出处理：视同本插件 worker 退出（崩溃/被杀由 PoolManager 通知） */
  private handleExit(_reason: string): void {
    this.loadFailed = true
    this.poolExitUnsub?.()
    this.poolExitUnsub = undefined
    this.poolLoadFailedUnsub?.()
    this.poolLoadFailedUnsub = undefined
    this.closeDirectPort()
    // worker 实际已退出：清掉残留 rpcClient（否则 isRunning 误报 true，ensure-worker 会死等端口）
    if (this.rpcClient) {
      this.rpcClient.dispose()
      this.rpcClient = undefined
    }
    this.emitStatus({ id: this.instanceKey, version: this.version, status: 'stopped', generation: 0, enabled: false })
    if (!this.stoppedByManager) this.onExited?.(this.instanceKey, 'exit')
  }

  /** 关闭直连 port1（worker 退出 / 主动停止时） */
  private closeDirectPort(): void {
    if (this.directPort1) {
      try {
        this.directPort1.close()
      } catch {
        /* 已关闭忽略 */
      }
      this.directPort1 = undefined
      // 通道已废弃，下一轮 port-setup 是新实例，允许重新交付
      this.lastDeliveredPort = undefined
    }
  }

  /**
   * 重建直连通道：port1 一经 transfer 给渲染层即 neutered（不可二次下发）。
   * 渲染层重载 / 端口表清空后再要 port 时，重新创建一条 MessageChannelMain：
   * 池模式经 reattach-direct 让 pool-worker 把新 direct port 交给插件 rpc（覆盖旧 directPort 并回
   * direct-port-ready），新 port1 待 worker 就绪后经 onDirectPortReady 交上层分发渲染层。
   */
  refreshDirectPort(): boolean {
    // workerless 无直连端口；未 fork（无 rpcClient）也无端口可重建 → 明确返回 false，
    // 避免池层对未加载 pluginId 的 reattach 静默 no-op，让渲染层白等 15s
    if (!this.pool.alive || this.workerless || !this.rpcClient) return false
    this.closeDirectPort()
    const { port1, port2 } = new MessageChannelMain()
    this.directPort1 = port1
    this.pool.reattachDirect(this.instanceKey, port2)
    return true
  }

  /** 注册 worker 就绪回调（instanceKey, port1） */
  setDirectPortReady(callback: (instanceKey: InstanceKey, port: MessagePortMain) => void): void {
    this.onDirectPortReady = callback
  }

  /** 注册 worker 退出回调（instanceKey, reason） */
  setExited(callback: (instanceKey: InstanceKey, reason?: string) => void): void {
    this.onExited = callback
  }

  /** 调用目标 worker 的方法（经控制面 rpc-call；fromPluginId 为跨插件调用来源，worker 侧经 ctx 接收） */
  callWorker(method: string, args: unknown[] = [], fromPluginId?: string): Promise<unknown> {
    if (!this.rpcClient) {
      // 结构化错误（带码，供上层映射 WORKER_NOT_RUNNING）；workerless 与「已退出」区分文案
      const msg = this.workerless
        ? `plugin has no worker: ${this.instanceKey}`
        : `plugin worker not running: ${this.instanceKey}`
      return Promise.reject(new DlientError(DlientErrorCode.WORKER_NOT_RUNNING, msg))
    }
    return this.rpcClient.call(method, args, fromPluginId)
  }

  /** 向本插件 worker 推送宿主主动事件（child-event 流式输出/退出等） */
  sendControlMessage(message: unknown): void {
    if (!this.rpcClient) return
    this.rpcClient.sendControlMessage(message)
  }

  /** 请求业务状态快照（重启前；1s 窗口，未注册 handler / 超时 / 失败均返回 undefined） */
  async requestSnapshot(): Promise<unknown | undefined> {
    if (!this.rpcClient) return undefined
    const res = await this.rpcClient.requestSnapshot()
    if (!res) return undefined
    if (res.error) {
      console.error(`[plugin:${this.instanceKey}] snapshot failed:`, res.error)
      return undefined
    }
    return res.snapshot
  }

  /** 恢复业务状态快照（重启后新 worker 回灌；消息保序先于后续调用） */
  restoreSnapshot(snapshot: unknown): void {
    this.rpcClient?.restoreSnapshot(snapshot)
  }

  /** 注册 worker 推送回调（bridge 分发到渲染层订阅 view / 主进程广播；可多次注册） */
  onPush(callback: (event: string, data: unknown) => void): void {
    if (this.rpcClient) {
      this.rpcClient.onPush(callback)
    }
  }

  getRpcClient(): WorkerRpcClient | undefined {
    return this.rpcClient
  }

  getManifest(): PluginManifest {
    return this.manifest
  }

  updateManifest(manifest: PluginManifest): void {
    this.manifest = manifest
  }

  private emitStatus(runtime: PluginRuntime): void {
    this.onStatusChange?.(runtime)
  }

  dispose(): void {
    this.stop()
  }
}
