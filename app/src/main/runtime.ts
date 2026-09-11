/**
 * 主进程插件运行时装配（runtime.ts）。
 * 职责：装配 Kernel / RuntimeRegistry / HostCapabilities / PluginManager，
 *       把 export.ts 的宿主能力执行器注入 PluginController；
 *       提供插件启动 / 调用 / 推送 / 停止等运行时入口（供 bridge.ts 与主进程装配使用）。
 */

import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dialog, type MessageBoxOptions } from 'electron'
import { DlientError, DlientErrorCode, Kernel, RuntimeRegistry, HostCapabilities, PluginManager, PoolManager } from '@dlient-open/core'
import type { HostCapability, PluginManifest } from '@dlient-open/core'
import { localizeText } from '@dlient-open/plugin-sdk'
import { executeHostApi, type HostApiContext } from './export'
import { clearHostedSpawnsByOwner } from './lib/child'
import { appendPluginLog, clearLogSubscribersFor, formatPluginLogLine } from './lib/log'
import { allApis } from './api'
import { childHandleControl, subscribeChildHandle } from './lib/child'
import { killChildrenByOwner } from './child-registry'
import { GrantStore } from './grants'
import { getMainLocale, mt } from './i18n'
import type { ResourceGrantStore } from './resource-grants'
import { recordPluginLaunch, recordPluginCrash, shouldIsolate } from './installed-registry'
import { verifyPluginPackageStartable } from './org'
import type { PluginRecord } from '../types'

/** 本模块目录（主进程产物 ESM，无 __dirname；pool-worker.js 与 index 同目录） */
const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url))

/** 宿主主进程特权身份（与 @dlient-open/core access.ts 的 HOST_PLUGIN_ID 同值，仅主进程内部使用） */
const HOST_PLUGIN_ID = 'host'

export interface DlientRuntime {
  kernel: Kernel
  registry: RuntimeRegistry
  capabilities: HostCapabilities
  manager: PluginManager
  /** 启动插件 worker（market/local/dev 来源统一入口） */
  startPlugin(record: PluginRecord): Promise<void>
  /** 停止插件 */
  stopPlugin(pluginId: string): Promise<void>
  /** 重启插件（热重载：停旧 worker → 重新 fork 最新 dist 产物） */
  restartPlugin(pluginId: string): Promise<unknown>
  /** 调用插件 worker 方法（渲染层 bridge 转发入口；pluginId 来自已登记的 view） */
  callWorker(pluginId: string, method: string, args: unknown[]): Promise<unknown>
  /** 跨插件调用（host-api plugin.invoke） */
  invokePlugin(fromPluginId: string, targetPluginId: string, method: string, args: unknown[]): Promise<unknown>
  /** UI 端直连 host-api（渲染层 bridge 转发；channel='ui'，按 UI_OPEN_METHODS 白名单 + 视图身份执行） */
  executeUiHostApi(pluginId: string, method: string, args: unknown[], viewId?: string): Promise<unknown>
  /** 插件元信息（名称 i18n + 图标；notification 默认值注入用；controller 缺失时磁盘 manifest 兜底） */
  getPluginMeta(pluginId: string): { name?: string; icon?: string } | null
  /** 调用前校验（渲染层跨插件直连 render:validate-call 用；confirm 档未授权时走 §7 运行时确认） */
  authorizeCall(fromPluginId: string, targetPluginId: string, method: string): Promise<{ ok: boolean; error?: string; code: number }>
  /** 批量申请跨插件能力（'pluginId.method' 数组）：仅 runtime-confirm 档弹授权确认（多个能力一个弹框），其余直接返回授权状态 */
  requestPermissions(fromPluginId: string, capabilities: string[]): Promise<PermissionResult>
  /** 跨插件 dev 日志访问授权（'logs.view.<filterId>' 能力）：无授权 → 复用 runtime-confirm 弹框确认 → 写 1 天授权 */
  authorizeLogAccess(fromPluginId: string, filterId: string): Promise<{ ok: boolean; error?: string; code: number }>
  /** 插件 worker 是否已运行（ensure-worker 判断用） */
  isRunning(pluginId: string): boolean
  /** 是否无 worker 产物（ui 类型 / 纯 UI 的 app）：bridge ENSURE_WORKER 快速失败用 */
  isWorkerless(pluginId: string): boolean
  /** 直连 port 是否已就绪（running 状态可能早于 port-ready 握手；dev-runtime 确认 worker 真就绪用） */
  isPortReady(pluginId: string): boolean
  /** 所有实例运行时状态（含正式与 dev 双版本；dev runtime 状态同步用） */
  listRuntimeStates(): unknown[]
  /** 重建插件直连通道（bridge ensure-worker 用：已下发的 port 不可重复 transfer，需重建后异步下发） */
  refreshDirectPort(pluginId: string): boolean
  /** 注册 worker 直连 port 就绪回调（bridge 装配：下发渲染层 preload） */
  setPluginPortReadyCallback(callback: (pluginId: string, port: import('electron').MessagePortMain) => void): void
  /** 注册 worker 退出/失联回调（bridge 装配：广播渲染层清理） */
  setPluginExitedCallback(callback: (pluginId: string, reason?: string) => void): void
  /** 为插件 worker 注册推送回调（bridge 分发到渲染层订阅 view） */
  onPluginPush(pluginId: string, callback: (event: string, data: unknown) => void): void
  dispose(): Promise<void>
}

/**
 * 调用错误码（兼容导出：数值与 @dlient-open/core DlientErrorCode 一致，真源在 core errors.ts）。
 * docs/v3/plugin-view.md §7
 */
export const CALL_ERR = {
  OK: DlientErrorCode.OK,
  NOT_INSTALLED: DlientErrorCode.NOT_INSTALLED, // 目标插件未安装且不可安装（如不在市场）
  INSTALL_FAILED: DlientErrorCode.INSTALL_FAILED, // 目标插件安装失败（附原因）
  USER_DENIED: DlientErrorCode.USER_DENIED, // 用户拒绝授权
  TIMEOUT: DlientErrorCode.TIMEOUT, // 用户确认超时
  INVALID: DlientErrorCode.INVALID, // 授权记录无效 / 其它拒绝
} as const

/** 运行时授权确认条目（宿主裁决「需要确认」的能力，统一交给渲染层弹框） */
export interface RuntimeConfirmItem {
  /** 唯一键：'<targetPluginId>.<method>'（授权表 grant 按 from/target/method 记账） */
  key: string
  fromPluginId: string
  targetPluginId: string
  method: string
  /** 方法说明（弹框展示；缺省由 runtime 取 expose.description） */
  desc?: string
}

/** 渲染层弹框展示条目（名称已由宿主解析为本地化文本，渲染层直接展示） */
export interface RuntimeConfirmDisplayItem {
  fromName: string
  targetName: string
  method: string
  desc?: string
  /** 资源级确认：资源位置（文件/目录路径 / URL / 命令）展示文本 */
  resource?: string
  /** 目标插件 icon 可加载 URL（dlientOpen://plugin/<id>/<icon>）；跨插件确认用目标插件图标 */
  iconSrc?: string
}

/** 确认类型（四类 + 批量；docs/specs/plugin-permission.md §6） */
export type RuntimeConfirmType = 'runtime-confirm' | 'fs-access' | 'net-access' | 'spawn-confirm' | 'batch'
/** 授权作用域（§4.6）：persistent=始终允许（落盘）；session=仅本次（内存，宿主重启失效） */
export type RuntimeGrantScope = 'persistent' | 'session'

/** 渲染层确认请求（宿主 → 渲染层） */
export interface RuntimeConfirmRequest {
  type: RuntimeConfirmType
  items: RuntimeConfirmDisplayItem[]
  /** 是否展示作用域三选（始终允许 / 仅本次 / 拒绝）；runtime-confirm 为 false */
  canScope?: boolean
  /** 批量预授权：逐项独立确认（auth.requestGrants） */
  batch?: boolean
  /** 来源插件 id（同源确认聚合键；delegate 按此合并短窗口内多次请求） */
  fromPluginId?: string
}

/** 渲染层确认结果：allow=是否放行；scope=授权作用域（runtime-confirm 恒为 persistent） */
export interface RuntimeConfirmResult {
  allow: boolean
  scope: RuntimeGrantScope
}

/** 批量申请结果：granted = 已授权可调用（含已授权/免确认档）；denied = 用户拒绝或不可授权 */
export interface PermissionResult {
  granted: string[]
  denied: string[]
}

export interface CreateRuntimeOptions {
  /** 快捷键动作执行（如 'show-main-window' → 显示主窗口），由主进程装配注入 */
  runShortcutAction?: (action: string) => void
  /** 启动已安装插件（主进程注入：从已安装记录定位并 startPlugin；invokePlugin 目标未运行时使用） */
  ensurePluginWorker?: (pluginId: string) => Promise<{ ok: boolean; error?: string; code?: number }>
  /** 授权表（主进程装配注入；confirm 档调用校验与授权持久化） */
  grants?: GrantStore
  /** 资源级授权表（fs/net/spawn；插件启动时注册 manifest fsDirs / spawnCmds） */
  resourceGrants?: Record<'fs' | 'net' | 'spawn', ResourceGrantStore>
  /** 进程级封禁读白名单（§2）：worker 启动所需读集（插件根 + node_modules + 共享运行时目录） */
  permissionReadDirs?: string[]
  /** 运行时授权确认框委托（渲染层 modal.confirm 实现；缺省回退主进程原生对话框，仅作防御兜底） */
  runtimeConfirm?: (req: RuntimeConfirmRequest) => Promise<RuntimeConfirmResult>
  /** 按插件 id 定位磁盘记录（含 '@dev' 实例键 → base id；ensureLiveDeclarations 磁盘兜底用：
   *  无运行中 controller 时据记录路径读取 package.json 的 dlient.permissions 补授权） */
  locatePlugin?: (pluginId: string) => PluginRecord | null
  /** dev 源码根目录列表（dev 模式本地仓库根；包验签跳过判定用 —— userData/plugins 下的安装插件不在此列、始终验证） */
  devSourceRoots?: string[]
}

export function createRuntime(options: CreateRuntimeOptions = {}): DlientRuntime {
  const kernel = new Kernel()
  const registry = new RuntimeRegistry()
  const capabilities = new HostCapabilities()
  // api 目录单一数据源：注入全部 host-api 能力（方案 v2，随 api 迁移扩充）
  capabilities.registerCapabilities(
    allApis.map((a): HostCapability => ({
      id: a.key,
      name: a.key,
      description: { 'zh-CN': a.description['zh-CN'], 'en-US': a.description['en-US'] },
      allowedFor: 'all',
    })),
  )
  const manager = new PluginManager(registry, capabilities)
  const grants = options.grants

  // 共享 worker 池：system 独立池 + 其它按类型（app/full/worker）分池，每池 ≤8（超限自动开新池）。
  // pool-worker.js 为主进程多入口产物（见 vite.config.ts），与主进程同目录。
  // 阶段 2（docs/specs/pool.md §4）：dev / workerMode:solo / 观察期 / 隔离版本 → solo 池（一插件一池，
  // 崩溃/阻塞只影响自己）；稳定版本（poolable）→ 按类型共享池。system 插件走 'system' 池不评估。
  const poolManager = new PoolManager({
    poolWorkerPath: join(RUNTIME_DIR, 'pool-worker.js'),
    // 进程级封禁（§2）：除 system 池外全部池（shared + solo）注入 --permission；DLIENT_DISABLE_PERMISSION=1 可紧急关闭
    permission: {
      enabled: process.env.DLIENT_DISABLE_PERMISSION !== '1',
      readDirs: options.permissionReadDirs,
    },
  })
  manager.setPoolProvider((manifest) => {
    const key = poolManager.poolKeyFor(manifest)
    if (key === 'system') return poolManager.poolFor(key)
    if (shouldIsolate(manifest.id, manifest.version, manifest.source, manifest.workerMode)) {
      return poolManager.poolFor(poolManager.soloKeyFor(manifest))
    }
    return poolManager.poolFor(key)
  })

  // 授权表注入：canInvoke 的 confirm 档查询
  if (grants) manager.setAccessChecker((grantee, target, method) => grants.has(grantee, target, method))

  const runShortcutAction = options.runShortcutAction ?? (() => {})

  /** 目标插件名称（本地化，按主进程当前语言；确认框文案） */
  function pluginName(pluginId: string): string {
    const manifest = manager.getController(pluginId)?.getManifest()
    if (!manifest) return pluginId
    return localizeText(manifest.name, getMainLocale(), pluginId)
  }

  /** 目标插件 icon URL（跨插件确认弹框展示对方图标；dlientOpen://plugin/<id>/<icon> 由协议映射插件根目录） */
  function pluginIconSrc(targetPluginId: string): string | undefined {
    const icon = manager.getController(targetPluginId)?.getManifest().icon
    if (typeof icon !== 'string' || !icon) return undefined
    return `dlientOpen://plugin/${encodeURIComponent(targetPluginId)}/${icon.replace(/^\/+/, '')}`
  }

  /** 插件元信息（名称 i18n + 图标 URL；notification 默认值注入）；controller 缺失时按 locatePlugin 磁盘 manifest 兜底 */
  function getPluginMeta(pluginId: string): { name?: string; icon?: string } | null {
    let manifest = manager.getController(pluginId)?.getManifest()
    if (!manifest) {
      const record = options.locatePlugin?.(pluginId)
      if (record?.path) manifest = loadManifest(record)
    }
    if (!manifest) return null
    const name = localizeText(manifest.name, getMainLocale(), pluginId)
    const icon = typeof manifest.icon === 'string' && manifest.icon ? manifest.icon : undefined
    return { name, icon: icon ? `dlientOpen://plugin/${encodeURIComponent(pluginId)}/${icon.replace(/^\/+/, '')}` : undefined }
  }

  /** 方法说明（确认框文案；取 expose[method].description） */
  function methodDescription(targetPluginId: string, method: string): string {
    return manager.getController(targetPluginId)?.getManifest().expose?.[method]?.description ?? ''
  }

  /**
   * 调用前校验 + 运行时确认（docs/v3/plugin-view.md §2.3 / §7）。
   * - 基础 access 放行 → { ok: true, code: 0 }；
   * - runtime-confirm 未授权 → 渲染层弹框确认（modal.confirm 委托），确认后写入 1 天授权并放行；
   * - 用户拒绝 / 其它拒绝 → 返回错误码（-1003 / -1005 等）。
   */
  async function authorizeCall(
    fromPluginId: string,
    targetPluginId: string,
    method: string,
  ): Promise<{ ok: boolean; error?: string; code: number; scope?: RuntimeGrantScope }> {
    const check = manager.canInvoke(fromPluginId, targetPluginId, method)
    if (check.ok) return { ok: true, code: CALL_ERR.OK }

    if (check.code === DlientErrorCode.NEED_RUNTIME_CONFIRM) {
      const confirmed = await requestRuntimeConfirm(
        [{ key: `${targetPluginId}.${method}`, fromPluginId, targetPluginId, method }],
        { type: 'runtime-confirm', canScope: true }, // 三选：拒绝 / 仅本次允许 / 始终允许
      )
      if (!confirmed.allow) {
        return { ok: false, code: CALL_ERR.USER_DENIED, error: 'user denied runtime confirmation' }
      }
      // 始终允许 → 永久授权（expiresAt=null）；仅本次允许（session）→ 不落库（仅本次放行）
      if (confirmed.scope === 'persistent') {
        grants?.grant(fromPluginId, targetPluginId, method, null)
      }
      return { ok: true, code: CALL_ERR.OK, scope: confirmed.scope }
    }

    if (check.code === DlientErrorCode.NEED_INSTALL_CONFIRM) {
      return { ok: false, code: CALL_ERR.INVALID, error: check.error ?? 'install confirmation required' }
    }
    return { ok: false, code: CALL_ERR.INVALID, error: check.error ?? 'access denied' }
  }

  /**
   * 调被调用方 grant（主进程特权调用，决策 11）：
   * - 被调用方未暴露 grant / 有 grant 但实际未导出（worker 未 registerHandler，调用抛错）/
   *   返回值非三态 → 返回 null（调用方按「无 grant」拒绝）；
   * - 成功返回三态 { status: 'allow' | 'ask' | 'deny' }。
   */
  async function tryTargetGrant(
    fromPluginId: string,
    targetPluginId: string,
    method: string,
    data?: unknown,
  ): Promise<{ status: 'allow' | 'ask' | 'deny' } | null> {
    const targetController = manager.getController(targetPluginId)
    if (!targetController?.getManifest().expose?.['grant']) return null
    const fromManifest = manager.getController(fromPluginId)?.getManifest()
    try {
      const res = (await targetController.callWorker(
        'grant',
        [
          {
            method,
            plugin_id: fromPluginId,
            version: fromManifest?.version,
            org: fromManifest?.organization,
            ...(data !== undefined ? { data } : {}),
          },
        ],
        HOST_PLUGIN_ID,
      )) as { status?: string } | undefined
      const status = res?.status
      if (status === 'allow' || status === 'ask' || status === 'deny') return { status }
      return null // 返回值非三态 → 视为无 grant
    } catch {
      // 有 grant 但实际未导出（METHOD_NOT_REGISTERED 等）/ worker 失联 → 视为无 grant
      return null
    }
  }

  /**
   * 跨插件授权判定（决策 11）：被调用方**必须提供 grant**，否则拒绝。
   * - allow → 写永久授权（expiresAt=null）放行；
   * - deny → 拒绝（返回拒绝错误码，前端报错）；
   * - ask → 落到三选确认框（拒绝 / 仅本次允许 / 始终允许）。
   */
  async function tryGrant(
    fromPluginId: string,
    targetPluginId: string,
    method: string,
  ): Promise<{ ok: boolean; code?: number; error?: string }> {
    const g = await tryTargetGrant(fromPluginId, targetPluginId, method)
    if (!g) {
      return {
        ok: false,
        code: DlientErrorCode.ACCESS_DENIED,
        error: `target "${targetPluginId}" does not provide grant for method "${method}"`,
      }
    }
    if (g.status === 'allow') {
      grants?.grant(fromPluginId, targetPluginId, method, null)
      return { ok: true }
    }
    if (g.status === 'deny') {
      return {
        ok: false,
        code: DlientErrorCode.ACCESS_DENIED,
        error: `grant denied by "${targetPluginId}" for method "${method}"`,
      }
    }
    // ask → 三选确认框（拒绝 / 仅本次 / 始终）
    return authorizeCall(fromPluginId, targetPluginId, method)
  }

  /**
   * 调用方是否已在 manifest.dependencies 声明「调用 target.method」（完整 expose key）。
   */
  function hasDeclaredDependency(fromPluginId: string, targetPluginId: string, method: string): boolean {
    return !!manager.getController(fromPluginId)?.getManifest().dependencies?.[targetPluginId]?.includes(method)
  }

  /** 调用方是否为 system 插件（宿主内置可信插件，免 dependencies 声明校验） */
  function isSystemCaller(fromPluginId: string): boolean {
    return manager.getController(fromPluginId)?.getManifest().system === true
  }

  /**
   * api.plugin.requestGrant：插件 A 主动向目标插件请求授权。
   * 主进程补全 A 身份后调 B.grant（三态）：
   * - allow → 写永久授权，返回 { allowed: true, scope: 'persistent' }；
   * - deny → 拒绝；
   * - ask → 三选确认框（拒绝 / 仅本次 / 始终），按 scope 落库；
   * - 被调用方无 grant / 未导出 → 拒绝。
   */
  async function requestGrant(
    fromPluginId: string,
    targetPluginId: string,
    method: string,
    data?: unknown,
  ): Promise<{ allowed: boolean; scope?: RuntimeGrantScope; reason?: string }> {
    const g = await tryTargetGrant(fromPluginId, targetPluginId, method, data)
    if (!g) return { allowed: false, reason: 'no-grant' }
    if (g.status === 'allow') {
      grants?.grant(fromPluginId, targetPluginId, method, null)
      return { allowed: true, scope: 'persistent' }
    }
    if (g.status === 'deny') return { allowed: false, reason: 'deny' }
    // ask → 三选确认框
    const auth = await authorizeCall(fromPluginId, targetPluginId, method)
    if (!auth.ok) return { allowed: false, reason: 'deny' }
    return { allowed: true, scope: auth.scope ?? 'persistent' }
  }

  /**
   * 运行时确认：默认委托渲染层 modal.confirm（宿主只发起请求并等待回传，见 runtime-confirm.ts）。
   * 多条能力合并到一个弹框展示；超时/无渲染层按拒绝处理。缺省委托时回退原生对话框（防御兜底）。
   */
  function requestRuntimeConfirm(
    items: RuntimeConfirmItem[],
    extra?: { type?: RuntimeConfirmType; canScope?: boolean; resource?: string },
  ): Promise<RuntimeConfirmResult> {
    const type = extra?.type ?? 'runtime-confirm'
    const display: RuntimeConfirmDisplayItem[] = items.map((it) => ({
      fromName: pluginName(it.fromPluginId),
      targetName: pluginName(it.targetPluginId),
      method: it.method,
      desc: it.desc ?? methodDescription(it.targetPluginId, it.method),
      resource: extra?.resource,
      iconSrc: pluginIconSrc(it.targetPluginId),
    }))
    const delegate = options.runtimeConfirm
    if (delegate) {
      return delegate({
        type,
        items: display,
        canScope: extra?.canScope === true,
        fromPluginId: items[0]?.fromPluginId,
      })
    }
    // 兜底：无渲染层委托（独立装配场景）→ 主进程原生对话框（多条合并单框展示）
    return new Promise<RuntimeConfirmResult>((resolve) => {
      let settled = false
      const finish = (allow: boolean) => {
        if (settled) return
        settled = true
        resolve({ allow, scope: 'persistent' })
      }
      const desc = items
        .map(
          (it) =>
            `${mt('runtime.confirm.line.fromTo', { from: pluginName(it.fromPluginId), target: pluginName(it.targetPluginId) })}：${it.method}${it.desc ?? methodDescription(it.targetPluginId, it.method) ? `（${it.desc ?? methodDescription(it.targetPluginId, it.method)}）` : ''}`,
        )
        .join('\n')
      const opts: MessageBoxOptions = {
        type: 'question',
        title: mt('runtime.confirm.title'),
        message:
          items.length > 1
            ? mt('runtime.confirm.message.multi')
            : mt('runtime.confirm.message.single', {
                from: pluginName(items[0].fromPluginId),
                target: pluginName(items[0].targetPluginId),
              }),
        detail: `${desc}\n\n${mt('runtime.confirm.hint')}`,
        buttons: [mt('runtime.confirm.allow'), mt('runtime.confirm.deny')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      void dialog.showMessageBox(opts).then(({ response }) => finish(response === 0))
      // 确认框挂起超时兜底（60s）
      setTimeout(() => finish(false), 60_000)
    })
  }

  /**
   * 跨插件 dev 日志访问授权（方案C）：'logs.view.<filterId>' → 目标 '<filterId>@dev'。
   * 无授权时复用 runtime-confirm 弹框（from→target 名称 + 说明）确认，通过后写 1 天授权；
   * 已授权直接放行（grants.has 同步判定）。filterId 只允许逻辑 id 字符集（防路径穿越）。
   */
  async function authorizeLogAccess(
    fromPluginId: string,
    filterId: string,
  ): Promise<{ ok: boolean; error?: string; code: number }> {
    const id = String(filterId ?? '').trim()
    if (!/^[a-z0-9-]+$/.test(id)) {
      return { ok: false, code: CALL_ERR.INVALID, error: `invalid log target: ${id}` }
    }
    const target = `${id}@dev`
    const logMethod = 'logs'
    if (grants?.has(fromPluginId, target, logMethod)) return { ok: true, code: CALL_ERR.OK }
    const confirmed = await requestRuntimeConfirm(
      [
        {
          key: `${target}.${logMethod}`,
          fromPluginId,
          targetPluginId: target,
          method: logMethod,
          desc: mt('runtime.confirm.logAccess.desc'),
        },
      ],
      { type: 'runtime-confirm', canScope: true }, // 三选：拒绝 / 仅本次允许 / 始终允许
    )
    if (!confirmed.allow) {
      return { ok: false, code: CALL_ERR.USER_DENIED, error: 'user denied log access' }
    }
    // 始终允许 → 永久授权；仅本次允许（session）→ 不落库（仅本次放行）
    if (confirmed.scope === 'persistent') {
      grants?.grant(fromPluginId, target, logMethod, null)
    }
    return { ok: true, code: CALL_ERR.OK }
  }

  /**
   * 批量申请跨插件能力（'pluginId.method' 数组）：
   * - 'logs.view.<filterId>' 专属能力 → authorizeLogAccess（dev 日志访问，runtime-confirm + 1 天授权）；
   * - 已授权 / 免确认档（default/system/public）→ 直接计入 granted；
   * - runtime-confirm 未授权 → 合并进一次运行时确认弹框，通过后批量写入 1 天授权；
   * - 其余（access denied / install-confirm / target not found / 格式非法）→ denied。
   */
  async function requestPermissions(fromPluginId: string, capabilities: string[]): Promise<PermissionResult> {
    const granted: string[] = []
    const denied: string[] = []
    const pendingItems: RuntimeConfirmItem[] = []
    for (const cap of capabilities ?? []) {
      const capStr = String(cap ?? '')
      if (capStr.startsWith('logs.view.')) {
        const auth = await authorizeLogAccess(fromPluginId, capStr.slice('logs.view.'.length))
        if (auth.ok) granted.push(capStr)
        else denied.push(capStr)
        continue
      }
      const dot = capStr.indexOf('.')
      if (dot <= 0 || dot === capStr.length - 1) {
        denied.push(capStr)
        continue
      }
      const target = capStr.slice(0, dot)
      const method = capStr.slice(dot + 1)
      const check = manager.canInvoke(fromPluginId, target, method)
      if (check.ok) {
        granted.push(capStr)
        continue
      }
      if (check.code === DlientErrorCode.NEED_RUNTIME_CONFIRM) {
        pendingItems.push({ key: capStr, fromPluginId, targetPluginId: target, method })
        continue
      }
      denied.push(capStr)
    }
    if (pendingItems.length > 0) {
      const allowed = await requestRuntimeConfirm(pendingItems, { type: 'runtime-confirm', canScope: true })
      for (const it of pendingItems) {
        if (allowed.allow) {
          // 始终允许 → 永久授权；仅本次允许（session）→ 不落库（仅本次放行）
          if (allowed.scope === 'persistent') {
            grants?.grant(fromPluginId, it.targetPluginId, it.method, null)
          }
          granted.push(it.key)
        } else {
          denied.push(it.key)
        }
      }
    }
    return { granted, denied }
  }

  async function invokePlugin(fromPluginId: string, targetPluginId: string, method: string, args: unknown[]): Promise<unknown> {
    // 目标插件已安装但 worker 未启动（controller 缺失 / 已退出）：先确保就绪，
    // 否则 canInvoke 会因 controllers 里找不到目标而报「plugin not found」。
    if (!(await manager.ensureWorkerRunning(targetPluginId))) {
      const res = await options.ensurePluginWorker?.(targetPluginId)
      if (!res?.ok) throw new Error(res?.error ?? `plugin not found: ${targetPluginId}`)
    }
    const check = manager.canInvoke(fromPluginId, targetPluginId, method)
    if (!check.ok) {
      if (check.code === DlientErrorCode.NEED_RUNTIME_CONFIRM) {
        // confirm 档未授权：被调用方必须提供 grant（allow→永久授权 / deny→拒绝 / ask→用户三选）；
        // 无 grant 或 grant 未导出 → 拒绝。
        const auth = await tryGrant(fromPluginId, targetPluginId, method)
        if (!auth.ok) {
          const code = (auth.code ?? DlientErrorCode.ACCESS_DENIED) as DlientErrorCode
          throw new DlientError(code, `[ERR ${code}] ${auth.error ?? 'authorization denied'}`)
        }
      } else {
        // 结构化错误：统一数值码（METHOD_NOT_EXPOSED / ACCESS_DENIED / TARGET_NOT_FOUND ...），
        // message 保留 `[ERR -xxxx]` 前缀，兼容历史按文本解析的调用方。
        const code = check.code ?? DlientErrorCode.ACCESS_DENIED
        throw new DlientError(code, `[ERR ${code}] ${check.error}`)
      }
    } else if (!isSystemCaller(fromPluginId) && !hasDeclaredDependency(fromPluginId, targetPluginId, method) && !grants?.has(fromPluginId, targetPluginId, method)) {
      // dependencies 前置（决策 11）：access 放行但未声明依赖且无授权记录 → 需被调用方 grant 或用户确认。
      // system 插件为宿主内置可信插件（与 host-api 权限声明豁免一致）→ 自动放行，不做依赖声明校验。
      const auth = await tryGrant(fromPluginId, targetPluginId, method)
      if (!auth.ok) {
        const code = (auth.code ?? DlientErrorCode.ACCESS_DENIED) as DlientErrorCode
        throw new DlientError(code, `[ERR ${code}] ${auth.error ?? 'authorization denied'}`)
      }
    }
    return manager.invokePlugin(fromPluginId, targetPluginId, method, args)
  }

  // 授权/安全事件 → 对应插件日志（executeHostApi 拒绝时经 ctx.writePluginLog 调用）：
  // 每插件节流（1s 内 ≤10 条），避免恶意/高频调用把日志刷爆。
  const denyLogThrottle = new Map<string, { count: number; windowStart: number }>()
  const writePluginLog: HostApiContext['writePluginLog'] = (pluginId, level, message, data) => {
    if (typeof pluginId !== 'string' || !pluginId || !message) return
    const now = Date.now()
    const rec = denyLogThrottle.get(pluginId)
    if (!rec || now - rec.windowStart >= 1000) {
      denyLogThrottle.set(pluginId, { count: 1, windowStart: now })
    } else {
      if (rec.count >= 10) return
      rec.count++
    }
    void appendPluginLog(pluginId, formatPluginLogLine(level, 'host', message, data))
  }
  const ctx: HostApiContext = { invokePlugin, requestGrant, runShortcutAction, writePluginLog }

  // 按需补齐/重建声明授权：每次 host-api 调用前执行（幂等）。
  // - dev 插件（含 '<id>@dev' 别名基座）：从磁盘读 package.json 重建声明层（permissions / fsDirs / spawnCmds）——
  //   保存 manifest 后下一次调用即生效，移除权限不产生幽灵授权；声明层（capabilities / 声明表）可整体覆盖，
  //   运行时用户授权（持久/会话/临时 grants）绝不触碰。
  // - 非 dev：controller 快照优先；无 controller 时按 locatePlugin 定位磁盘记录读声明（须验签，防篡改即时提权）。
  const diskSeeded = new Set<string>()
  async function ensureLiveDeclarations(pluginId: string): Promise<void> {
    try {
      const ids = pluginId.endsWith('@dev') ? [pluginId, pluginId.replace(/@dev$/, '')] : [pluginId]
      for (const id of ids) {
        const record = options.locatePlugin?.(id)
        const isDev = id.endsWith('@dev') || record?.source === 'dev'
        // dev 插件（含其 '@dev' 别名基座）：每次调用前从磁盘重建声明层（permissions / fsDirs / spawnCmds）。
        // capabilities 与声明表整层覆盖（revokeAll + 重注册；fsDirs/spawnCmds 注册 undefined 即清零），
        // 保存 package.json 后下一次调用即生效，且移除权限不会「幽灵授权」；绝不触碰运行时用户授权
        // （持久/会话/临时 grants 与 permission.request / dialog 授权结果）。
        if (isDev && record?.path) {
          const manifest = loadManifest(record)
          capabilities.revokeAll(id)
          if (Array.isArray(manifest.permissions)) capabilities.grantPermissions(id, manifest.permissions)
          const rg = options.resourceGrants
          if (rg) {
            rg.fs.registerFsDirs(id, manifest.fsDirs)
            rg.spawn.registerSpawnCmds(id, { cmds: manifest.spawnCmds })
          }
          continue
        }
        // 非 dev：controller 快照优先，磁盘兜底（须验签，防篡改 package.json 即时提权）
        const perms = manager.getController(id)?.getManifest().permissions
        if (Array.isArray(perms) && perms.length > 0) {
          capabilities.grantPermissions(id, perms)
          continue
        }
        // 磁盘兜底：非 dev 插件每个 id 会话内只尝试一次，且须先通过包验签。
        const rec = record
        if (!rec?.path) continue
        if (rec.source !== 'dev') {
          if (diskSeeded.has(id)) continue
          diskSeeded.add(id)
          const v = await verifyPluginPackageStartable(rec.path, rec.id, {
            devSourceDirs: options.devSourceRoots,
            requireSigned: true, // 已安装插件严格验签：无 signature.json 不给磁盘声明补授权
            allowNoKey: rec.system === true,
          })
          if (!v.ok) continue // 篡改/无签名不一致 → 不给磁盘声明补授权
        }
        const diskPerms = loadManifest(rec).permissions
        if (Array.isArray(diskPerms) && diskPerms.length > 0) capabilities.grantPermissions(id, diskPerms)
      }
    } catch {
      /* 自愈失败不阻塞：后续正式声明校验会给出精确拒绝 */
    }
  }

  // 调用方插件的真实来源（market/local/dev；locatePlugin 内部已把 '@dev' 归并到基座 id；未定位兜底 'market'）。
  // 供 executeHostApi 的 canAccess allowedFor 判定与拒绝诊断使用；当前 allowedFor 全为 'all'，仅让诊断更准确。
  const sourceOf = (pluginId: string): 'market' | 'local' | 'dev' => options.locatePlugin?.(pluginId)?.source ?? 'market'

  // 宿主能力执行器：worker 的 callHostApi 经控制面 RPC 到达此处，授权校验后执行
  const hostApiExecutor = async (pluginId: string, method: string, args: unknown[]) => {
    await ensureLiveDeclarations(pluginId)
    return executeHostApi(pluginId, method, args, capabilities, sourceOf(pluginId), ctx, 'worker')
  }

  // UI 端直连 host-api：渲染层 bridge 转发，视图身份（instanceKey）注入后走同一授权链路（channel='ui'）
  const executeUiHostApi = async (pluginId: string, method: string, args: unknown[], viewId?: string) => {
    await ensureLiveDeclarations(pluginId)
    return executeHostApi(pluginId, method, args, capabilities, sourceOf(pluginId), ctx, 'ui', viewId)
  }

  // child 句柄内聚通道（worker → 宿主，非 host-api）：控制（kill/stdin）与事件订阅，owner 校验在 lib/child 内完成
  const childControlHandler = async (
    pluginId: string,
    handleId: string,
    op: 'kill' | 'write' | 'end',
    data?: string,
  ): Promise<{ ok: boolean; reason?: string }> => childHandleControl(pluginId, handleId, op, data)
  const childSubscribeHandler = (pluginId: string, handleId: string): void => subscribeChildHandle(pluginId, handleId)

  // 读取插件 manifest（package.json 的 dlient 子对象 + 顶层字段合并）
  // 注：fsDirs / spawnCmds 为资源授权扩展字段，npm @dlient-open/plugin-sdk 尚未包含，故以交集类型声明
  type ManifestWithResources = PluginManifest & {
    fsDirs?: { read?: string[]; write?: string[] }
    // F9：spawnCmds 支持 string（命令，参数不限）或 { cmd, argsPattern }（参数约束）
    spawnCmds?: (string | { cmd: string; argsPattern?: string })[]
    // 组织标识（'@xxx'；宿主 resolveOrg 判定后注入 PluginApi.organization）
    organization?: string
  }
  function loadManifest(record: PluginRecord): ManifestWithResources {
    const pkgPath = join(record.path, 'package.json')
    const pkg = JSON.parse(String(readFileSync(pkgPath, 'utf-8')).replace(/^\uFEFF/, '')) as Record<string, unknown> & {
      dlient?: Partial<ManifestWithResources>
    }
    const d = pkg.dlient ?? {}
    const candidate: ManifestWithResources = {
      id: d.id ?? String(pkg.name ?? record.id),
      version: String(d.version ?? pkg.version ?? record.version),
      name: d.name ?? String(pkg.name ?? record.id),
      // 类型层 description/icon 为必填（发布校验强制），宿主本地运行对缺失做空串兜底，不阻断 dev/存量插件
      description: d.description ?? '',
      dist: d.dist,
      type: d.type,
      system: d.system,
      source: d.source ?? record.source,
      icon: d.icon ?? '',
      organization: d.organization,
      requires: d.requires,
      platforms: d.platforms,
      permissions: d.permissions,
      fsDirs: d.fsDirs,
      spawnCmds: d.spawnCmds,
      expose: d.expose,
      dependencies: d.dependencies,
      engines: d.engines,
      author: d.author ?? (typeof pkg.author === 'string' ? pkg.author : undefined),
      homepage: d.homepage,
      repository: d.repository,
    }
    // type 缺省时按 'app'（manifest 规则：独立应用，启动后打开页面；宿主内建）
    if (!candidate.type) candidate.type = 'app'
    return candidate
  }

  async function startPlugin(record: PluginRecord): Promise<void> {
    const manifest = loadManifest(record)
    // 防篡改启动闸（已安装插件须带有效平台签名，无 signature.json 同样拒绝；dev 源码目录跳过）：
    // 改动 package.json / 注入未签名文件 / 目录被替换 / 无签名 → 验签失败 → 拒绝启动。
    // system 插件：公钥可用即本地验签，无公钥兜底放行（保离线自举）；下载链另有服务端签名。
    if (manifest.source !== 'dev') {
      const v = await verifyPluginPackageStartable(record.path, record.id, {
        devSourceDirs: options.devSourceRoots,
        requireSigned: true, // 已安装插件严格验签：无 signature.json 一律拒绝启动
        allowNoKey: manifest.system === true,
      })
      if (!v.ok) {
        throw new Error(
          `[ERR ${DlientErrorCode.PERMISSION_DENIED}] plugin package verification failed, cannot start "${record.id}": ${v.error}`,
        )
      }
    }
    // 注册 manifest 资源声明（fsDirs / spawnCmds）到资源授权表（host-api owner 用实例键，dev=<id>@dev）
    const regKey = manifest.source === 'dev' ? `${manifest.id}@dev` : manifest.id
    const rg = options.resourceGrants
    if (rg) {
      rg.fs.registerFsDirs(regKey, manifest.fsDirs)
      rg.spawn.registerSpawnCmds(regKey, { cmds: manifest.spawnCmds })
      // 仅 dev 插件授予自身源码目录 read+write：dev 从任意源码目录运行（manifest.fsDirs 只能静态声明
      // 别名，覆盖不到 record.path），本地调试读写 package.json 等不应依赖 plugins.dev.sync 的时序。
      // market/local **已安装**插件一律不授予自身安装目录（USER_DATA/plugins/<id>）任何权限：
      //  - 写：任何字节改动都会破坏 signature.json 验签（启动/协议双重闭环拒绝）；
      //  - 读：UI/静态资源由宿主经 dlientOpen:// 协议提供；native-host 由宿主代 spawn 官方 Node；
      //    插件自身无需经 fs 授权读取安装目录（宿主读取走自身白名单，与插件授权无关）。
      if (record.path && manifest.source === 'dev') {
        const selfDir = normalize(String(record.path))
        rg.fs.grant(regKey, selfDir, { mode: 'read' })
        rg.fs.grant(regKey, selfDir, { mode: 'write' })
      }
    }
    const result = await manager.install(manifest, record.path, hostApiExecutor, childControlHandler, childSubscribeHandler)
    if (!result.success) {
      throw new Error(result.error ?? `failed to start plugin: ${record.id}`)
    }
    // 阶段 2：启动成功进入 running → 记一次有效启动（市场/本地插件按版本计数；dev 不走评估）
    if (manifest.source !== 'dev') {
      void recordPluginLaunch(manifest.id, manifest.version).catch(() => undefined)
    }
  }

  async function stopPlugin(pluginId: string): Promise<void> {
    await manager.uninstall(pluginId)
  }

  async function restartPlugin(pluginId: string): Promise<unknown> {
    return manager.restartPlugin(pluginId)
  }

  async function callWorker(pluginId: string, method: string, args: unknown[]): Promise<unknown> {
    const controller = manager.getController(pluginId)
    if (!controller) {
      throw new Error(`plugin not running: ${pluginId}`)
    }
    return controller.callWorker(method, args)
  }

  function onPluginPush(pluginId: string, callback: (event: string, data: unknown) => void): void {
    manager.onPluginPush(pluginId, callback)
  }

  async function dispose(): Promise<void> {
    poolManager.dispose()
    await manager.dispose()
    kernel.dispose()
  }

  return {
    kernel,
    registry,
    capabilities,
    manager,
    startPlugin,
    stopPlugin,
    restartPlugin,
    callWorker,
    invokePlugin,
    executeUiHostApi,
    getPluginMeta,
    authorizeCall,
    requestPermissions,
    authorizeLogAccess,
    isRunning: (pluginId) => manager.isRunning(pluginId),
    isWorkerless: (pluginId) => manager.isWorkerless(pluginId),
    isPortReady: (pluginId) => manager.isPortReady(pluginId),
    listRuntimeStates: () => manager.listRuntimeStates(),
    refreshDirectPort: (pluginId) => manager.refreshDirectPort(pluginId),
    setPluginPortReadyCallback: (cb) => manager.setPluginPortReadyCallback(cb),
    setPluginExitedCallback: (cb) =>
      manager.setPluginExitedCallback((instanceKey, reason) => {
        // 阶段二：worker 退出 → 清理其经 child.register 上报的全部子进程（防孤儿）。
        // 异步 kill：回调是同步广播出口，不能阻塞（内部 await 完成后再清）
        void killChildrenByOwner(instanceKey)
        // 宿主代管子进程句柄（child.spawn 的 spawnHandles）同步按 owner 清理
        clearHostedSpawnsByOwner(instanceKey)
        // F11：清空该插件的日志订阅（防死回调引用滞留）
        clearLogSubscribersFor(instanceKey)
        // 阶段 2：崩溃退出（非主动 stop）→ 记崩溃计数（市场/本地插件；dev 不走评估）
        if (reason !== 'stopped') {
          const controller = manager.getController(instanceKey)
          if (controller && controller.getManifest().source !== 'dev') {
            void recordPluginCrash(controller.getManifest().id, controller.version).catch(() => undefined)
          }
        }
        cb(instanceKey, reason)
      }),
    onPluginPush,
    dispose,
  }
}
