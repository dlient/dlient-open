/**
 * PluginManager - 插件部署编排（staging → 授权 → 登记 → start → 原子切换）。
 */

import type { PluginManifest, PluginRuntime } from '@dlient-open/plugin-sdk'
import { PluginController, type PluginControllerOptions } from './plugin-controller'
import { RuntimeRegistry } from './runtime-registry'
import { HostCapabilities } from './host-capabilities'
import { evalAccessExpression, DEFAULT_ACCESS, type AccessEvalContext } from './access'
import { DlientError, DlientErrorCode, type DlientErrorCode as DlientErrorCodeValue } from './errors'
import { instanceKeyFor, type InstanceKey } from './instance'
import type { MessagePortMain } from 'electron'
import type { PluginPool } from './pool-manager'

export interface DeploymentResult {
  success: boolean
  pluginId: string
  version: string
  error?: string
}

export interface CanInvokeResult {
  ok: boolean
  error?: string
  /** 拒绝码（数值，DlientErrorCode）；ok=true 时缺省 */
  code?: DlientErrorCodeValue
}

export class PluginManager {
  /** controllers 以 instanceKey 为键（正式 = pluginId，dev = pluginId@dev），同逻辑插件可并存正式+dev 双实例 */
  private controllers = new Map<string, PluginController>()
  private registry: RuntimeRegistry
  private capabilities: HostCapabilities
  /** confirm 档授权查询（主进程 grants 模块注入；core 不直接持有加密/存储） */
  private accessChecker?: (grantee: string, target: string, method: string) => boolean
  /** worker 直连 port 就绪回调（instanceKey, port1）—— 多订阅（bridge 分发渲染层 + 主进程启动门等共存） */
  private onPluginPortReady = new Set<(instanceKey: InstanceKey, port: MessagePortMain) => void>()
  /** worker 退出/失联回调（instanceKey, reason）—— 装配注入，广播渲染层清理 */
  private onPluginExited?: (instanceKey: InstanceKey, reason?: string) => void
  /** 实例状态变更回调（controller emitStatus → registry → 订阅者；渲染层广播 / dev runtime 状态同步） */
  private onRuntimeChange = new Set<(runtime: PluginRuntime) => void>()
  /** 插件尚未启动时注册的推送回调（startPlugin/install 创建 controller 后补挂；避免 bootstrap 期注册丢失） */
  private pendingPushCallbacks = new Map<string, Array<(event: string, data: unknown) => void>>()
  /** 共享 worker 池提供者（按 manifest 分池；必须注入——全池化后无独立进程模式） */
  private poolProvider?: (manifest: PluginManifest) => PluginPool

  constructor(registry: RuntimeRegistry, capabilities: HostCapabilities) {
    this.registry = registry
    this.capabilities = capabilities
  }

  /** 注入 confirm 档授权查询（主进程装配 grants 模块时调用） */
  setAccessChecker(checker: (grantee: string, target: string, method: string) => boolean): void {
    this.accessChecker = checker
  }

  /** 注入共享 worker 池提供者（装配 PoolManager 时调用；全池化后必注入，未注入时安装会报错） */
  setPoolProvider(provider: (manifest: PluginManifest) => PluginPool): void {
    this.poolProvider = provider
  }

  /** 安装并启动插件（instanceKey = 正式 pluginId / dev pluginId@dev，源自 manifest.source） */
  async install(
    manifest: PluginManifest,
    pluginPath: string,
    hostApiExecutor?: PluginControllerOptions['hostApiExecutor'],
    childControlHandler?: PluginControllerOptions['childControlHandler'],
    childSubscribeHandler?: PluginControllerOptions['childSubscribeHandler'],
  ): Promise<DeploymentResult> {
    const instanceKey = instanceKeyFor(manifest.id, manifest.source, true)
    try {
      // 已存在旧控制器（崩溃 / 池内加载失败残留，isRunning 已返回 false）：先清理，避免池内重复加载。
      // 正常运行中的插件不会走到 install（调用方均先查 isRunning，运行中直接跳过）。
      const stale = this.controllers.get(instanceKey)
      if (stale) {
        await stale.stop().catch(() => undefined)
        this.controllers.delete(instanceKey)
      }

      if (!this.poolProvider) {
        return { success: false, pluginId: instanceKey, version: manifest.version, error: 'pool provider not injected (all plugins run in pools)' }
      }
      const controller = new PluginController({
        manifest,
        pluginPath,
        hostApiExecutor,
        childControlHandler,
        childSubscribeHandler,
        pool: this.poolProvider(manifest),
      })

      if (manifest.permissions) {
        this.capabilities.grantPermissions(instanceKey, manifest.permissions)
      }

      this.registry.setRuntime(instanceKey, {
        id: instanceKey,
        version: manifest.version,
        status: 'stopped',
        generation: 0,
        enabled: true,
      })

      controller.setStatusCallback((runtime) => {
        this.registry.setRuntime(instanceKey, runtime)
        this.notifyRuntimeChange(runtime)
      })

      // 装配直连 port 生命周期回调（多订阅逐个分发；单回调异常不影响其它订阅者）
      controller.setDirectPortReady((key, port) => {
        for (const cb of this.onPluginPortReady) {
          try {
            cb(key, port)
          } catch {
            /* 订阅者异常忽略 */
          }
        }
      })
      controller.setExited((key, reason) => {
        this.onPluginExited?.(key, reason)
      })

      const generation = this.registry.incrementGeneration(instanceKey)
      await controller.start(generation)

      this.controllers.set(instanceKey, controller)

      // 补挂启动前注册的推送回调（如 bootstrap 期注册的 auth-state 广播；此时 controller/rpcClient 已就绪）
      const pending = this.pendingPushCallbacks.get(instanceKey)
      if (pending) {
        for (const cb of pending) controller.onPush(cb)
        this.pendingPushCallbacks.delete(instanceKey)
      }

      this.registry.setInstalled(instanceKey, {
        id: instanceKey,
        version: manifest.version,
        installedAt: Date.now(),
        enabled: true,
      })

      return { success: true, pluginId: instanceKey, version: manifest.version }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      return { success: false, pluginId: instanceKey, version: manifest.version, error: error.message }
    }
  }

  /** 卸载插件（system 插件不可卸载） */
  async uninstall(pluginId: string): Promise<DeploymentResult> {
    const controller = this.controllers.get(pluginId)
    if (!controller) {
      return { success: false, pluginId, version: '', error: 'Plugin not found' }
    }
    if (controller.getManifest().system) {
      return { success: false, pluginId, version: controller.version, error: 'system plugin cannot be uninstalled' }
    }
    try {
      await controller.stop()
      this.controllers.delete(pluginId)
      this.registry.removeRuntime(pluginId)
      this.capabilities.revokeAll(pluginId)
      return { success: true, pluginId, version: controller.version }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      return { success: false, pluginId, version: controller.version, error: error.message }
    }
  }

  /** 启用插件 */
  async enable(pluginId: string): Promise<DeploymentResult> {
    const controller = this.controllers.get(pluginId)
    if (!controller) {
      return { success: false, pluginId, version: '', error: 'Plugin not found' }
    }
    const generation = this.registry.incrementGeneration(pluginId)
    await controller.start(generation)
    const installed = this.registry.getInstalled(pluginId)
    if (installed) {
      installed.enabled = true
      this.registry.setInstalled(pluginId, installed)
    }
    return { success: true, pluginId, version: controller.version }
  }

  /** 停用插件 */
  async disable(pluginId: string): Promise<DeploymentResult> {
    const controller = this.controllers.get(pluginId)
    if (!controller) {
      return { success: false, pluginId, version: '', error: 'Plugin not found' }
    }
    await controller.stop()
    const installed = this.registry.getInstalled(pluginId)
    if (installed) {
      installed.enabled = false
      this.registry.setInstalled(pluginId, installed)
    }
    return { success: true, pluginId, version: controller.version }
  }

  /** 重启插件（热重载：业务状态快照 → 停旧 worker → 以新 generation 重新加载最新 dist 产物 → 回灌快照）。
   *  幂等：实例未运行（dev 懒启动下 worker 从未 fork）时无需重启，直接成功，避免热重载误报 "Plugin not found"。 */
  async restartPlugin(pluginId: string): Promise<DeploymentResult> {
    const controller = this.controllers.get(pluginId)
    if (!controller) {
      return { success: true, pluginId, version: '', error: '' }
    }
    const generation = this.registry.incrementGeneration(pluginId)
    try {
      // 状态机（生命周期 12.3.5-①）：重启中 → restarting（停旧 → start 会走 starting → running）
      this.registry.updateStatus(pluginId, 'restarting')
      const restarting = this.registry.getRuntime(pluginId)
      if (restarting) this.notifyRuntimeChange(restarting)
      // 重启前 1s 窗口请求业务状态快照（未注册 handler / 超时 → undefined，正常重启）
      const snapshot = await controller.requestSnapshot()
      await controller.stop()
      await controller.start(generation)
      if (snapshot !== undefined) {
        try {
          controller.restoreSnapshot(snapshot)
        } catch (err) {
          console.error(`[plugin:${pluginId}] snapshot restore failed:`, err)
        }
      }
      return { success: true, pluginId, version: controller.version }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      return { success: false, pluginId, version: controller.version, error: error.message }
    }
  }

  /**
   * 调用前校验：A 是否允许调用 B.method（expose + access 表达式 + 授权表）。
   * 渲染层跨插件直连（render:validate-call）与 worker 编排（plugin.invoke）共用。
   * 返回 code 供上层区分：NEED_RUNTIME_CONFIRM / NEED_INSTALL_CONFIRM 可走用户确认流程。
   */
  canInvoke(fromPluginId: string, targetPluginId: string, method: string): CanInvokeResult {
    const targetManifest = this.controllers.get(targetPluginId)?.getManifest()
    if (!targetManifest) {
      return { ok: false, code: DlientErrorCode.TARGET_NOT_FOUND, error: `plugin not found: ${targetPluginId}` }
    }
    const exposed = targetManifest.expose?.[method]
    if (!exposed) {
      return { ok: false, code: DlientErrorCode.METHOD_NOT_EXPOSED, error: `plugin "${targetPluginId}" does not expose "${method}"` }
    }
    const access = exposed.access ?? DEFAULT_ACCESS
    const ctx: AccessEvalContext = {
      isSystem: (id) => this.controllers.get(id)?.getManifest().system === true,
      hasGrant: (grantee, target, m) => this.accessChecker?.(grantee, target, m) ?? false,
    }
    if (evalAccessExpression(access, fromPluginId, targetPluginId, method, ctx)) {
      return { ok: true }
    }
    // 命中 confirm 条件但无授权：区分拒绝原因，供上层走确认流程
    if (access.includes('runtime-confirm')) {
      return {
        ok: false,
        code: DlientErrorCode.NEED_RUNTIME_CONFIRM,
        error: `plugin "${fromPluginId}" needs runtime confirmation to call "${targetPluginId}.${method}"`,
      }
    }
    if (access.includes('install-confirm')) {
      return {
        ok: false,
        code: DlientErrorCode.NEED_INSTALL_CONFIRM,
        error: `plugin "${fromPluginId}" needs install confirmation to call "${targetPluginId}.${method}"`,
      }
    }
    return {
      ok: false,
      code: DlientErrorCode.ACCESS_DENIED,
      error: `plugin "${fromPluginId}" is not allowed to call "${targetPluginId}.${method}"`,
    }
  }

  /** 跨插件调用：A.worker → 主进程 plugin.invoke → B.worker（expose + dependencies 双重校验） */
  async invokePlugin(
    fromPluginId: string,
    targetPluginId: string,
    method: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    const check = this.canInvoke(fromPluginId, targetPluginId, method)
    if (!check.ok) {
      throw new DlientError(check.code ?? DlientErrorCode.INTERNAL, check.error ?? 'invoke denied')
    }
    const controller = this.controllers.get(targetPluginId)!
    // 把调用方 id 一并传给目标 worker（rpc-call.from_plugin_id），供多租户隔离
    return controller.callWorker(method, args, fromPluginId)
  }

  /** 插件是否可用（ensure-worker 判断用；池内加载失败/退出后 rpcClient 残留，须排除）。
   *  workerless（ui 类型 / 纯 UI 的 app）：无 worker 可跑，但插件本身即视为运行中。 */
  isRunning(pluginId: string): boolean {
    const controller = this.controllers.get(pluginId)
    return !!controller && !controller.isLoadFailed() && (controller.isWorkerless() || !!controller.getRpcClient())
  }

  /** 是否无 worker 产物（ui 类型 / 纯 UI 的 app）：bridge ENSURE_WORKER 快速失败用 */
  isWorkerless(pluginId: string): boolean {
    return this.controllers.get(pluginId)?.isWorkerless() ?? false
  }

  /** 直连 port 是否已就绪（worker 回 direct-port-ready 后为 true；running 状态可能早于 port 就绪）。
   *  workerless 无直连 port，但已「就绪」——消费方（dev-runtime 等）据此判定插件可用。 */
  isPortReady(pluginId: string): boolean {
    const controller = this.controllers.get(pluginId)
    if (!controller) return false
    return controller.isWorkerless() || controller.isDirectPortReady()
  }

  /**
   * 确保插件 worker 已运行：controller 已存在（install 过）但 worker 未运行 / 已退出时重新 fork。
   * controller 不存在（从未 install）时返回 false，由调用方（runtime.invokePlugin）从已安装记录启动。
   */
  async ensureWorkerRunning(pluginId: string): Promise<boolean> {
    const controller = this.controllers.get(pluginId)
    if (!controller) return false
    // workerless：无 worker 可起，视为已就绪（避免每次调用都重装 controller）
    if (controller.isWorkerless()) return true
    if (controller.getRpcClient()) return true
    const generation = this.registry.incrementGeneration(pluginId)
    await controller.start(generation)
    return !!controller.getRpcClient()
  }

  /** 注册 worker 直连 port 就绪回调（可多个；装配注入：bridge 下发渲染层、主进程启动门等） */
  setPluginPortReadyCallback(callback: (instanceKey: InstanceKey, port: MessagePortMain) => void): void {
    this.onPluginPortReady.add(callback)
  }

  /** 注册 worker 退出/失联回调（装配注入） */
  setPluginExitedCallback(callback: (instanceKey: InstanceKey, reason?: string) => void): void {
    this.onPluginExited = callback
  }

  /** 为插件 worker 注册推送回调（bridge 分发到渲染层订阅 view）；插件未启动时暂存，启动后补挂 */
  onPluginPush(pluginId: string, callback: (event: string, data: unknown) => void): void {
    const controller = this.controllers.get(pluginId)
    if (controller) {
      controller.onPush(callback)
      return
    }
    // 插件尚未启动（如 bootstrap 期注册）：暂存，install 创建 controller 后统一补挂
    const list = this.pendingPushCallbacks.get(pluginId)
    if (list) list.push(callback)
    else this.pendingPushCallbacks.set(pluginId, [callback])
  }

  /**
   * 获取正式实例控制器（对外调用统一走正式实例；pluginId 即正式 instanceKey）。
   * dev 实例需用 getInstanceController(instanceKey) 精确访问。
   */
  getController(pluginId: string): PluginController | undefined {
    return this.controllers.get(pluginId)
  }

  /** 按实例键获取控制器（正式 pluginId / dev pluginId@dev） */
  getInstanceController(instanceKey: InstanceKey): PluginController | undefined {
    return this.controllers.get(instanceKey)
  }

  /** 停止指定实例（dev runtime 停 dev 实例用；与 uninstall 不同：不处理权限/注册表业务） */
  async stopInstance(instanceKey: InstanceKey): Promise<DeploymentResult> {
    const controller = this.controllers.get(instanceKey)
    if (!controller) {
      return { success: false, pluginId: instanceKey, version: '', error: 'Plugin not found' }
    }
    try {
      await controller.stop()
      this.controllers.delete(instanceKey)
      this.registry.removeRuntime(instanceKey)
      return { success: true, pluginId: instanceKey, version: controller.version }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      return { success: false, pluginId: instanceKey, version: controller.version, error: error.message }
    }
  }

  /** 列出所有实例控制器（含正式与 dev 双版本），返回 instanceKey 列表 */
  listInstances(): InstanceKey[] {
    return Array.from(this.controllers.keys())
  }

  /** 列出所有实例运行时状态（含正式与 dev 双版本；dev runtime 状态同步用） */
  listRuntimeStates(): PluginRuntime[] {
    return Array.from(this.registry.getRuntimes().values())
  }

  /** 订阅实例状态变更（返回取消函数；controller emitStatus / restarting 均触发） */
  onRuntimeChangeCallback(cb: (runtime: PluginRuntime) => void): () => void {
    this.onRuntimeChange.add(cb)
    return () => this.onRuntimeChange.delete(cb)
  }

  /** 通知状态订阅者（单回调异常不影响其它） */
  private notifyRuntimeChange(runtime: PluginRuntime): void {
    for (const cb of this.onRuntimeChange) {
      try {
        cb(runtime)
      } catch {
        /* 订阅者异常忽略 */
      }
    }
  }

  /** 重建插件直连通道（渲染层端口表清空后 port1 已 transfer 不可重发；bridge ensure-worker 用） */
  refreshDirectPort(pluginId: string): boolean {
    return this.controllers.get(pluginId)?.refreshDirectPort() ?? false
  }

  async dispose(): Promise<void> {
    for (const [, controller] of this.controllers) {
      await controller.stop()
    }
    this.controllers.clear()
  }
}
