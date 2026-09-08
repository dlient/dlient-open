/**
 * 主进程 host-api 出口（export.ts）——最小化：仅保留 host-api 暴露面。
 * - host-api 类型（HostApiResult / HostApiContext / HostApiCallContext）
 * - 执行入口 executeHostApi（api 目录单一数据源：scope 校验 + 声明校验 + fs 白名单 + 审计 + plugin.invoke 特判）
 * - 能力清单 listHostApiMethods
 * 其余能力按主题下沉 lib/：日志 → lib/log.ts、文件 → lib/fs.ts、主题/语言广播 → lib/theme.ts、
 * 子进程 → lib/child.ts、插件/权限/网络/窗口等 → 各自 lib/；装配注入由 index.ts 从对应 lib 引入。
 */
import { DlientError, DlientErrorCode, HostCapabilities } from '@dlient-open/core'
import { errorDetail, logger } from '@dlient-open/core'
import { resolveRealSafe } from './resource-grants'
import { FS_PATH_MODE, assertPathAllowed, getGrantHooks } from './lib/grants'
import { getApi, listApiKeys } from './api'

export type HostApiResult = unknown

/** host-api 执行上下文（由 runtime 装配时注入；pluginId 由 executeHostApi 注入覆盖） */
export interface HostApiContext {
  /** 发起调用的插件 id（executeHostApi 注入，勿信调用方自报） */
  pluginId?: string
  /** 跨插件调用（主进程校验 expose + dependencies 后转发目标 worker） */
  invokePlugin: (fromPluginId: string, targetPluginId: string, method: string, args: unknown[]) => Promise<unknown>
  /** 主动预授权（api.plugin.requestGrant）：主进程补全调用方身份后调被调用方 grant，三态处理 */
  requestGrant: (
    fromPluginId: string,
    targetPluginId: string,
    method: string,
    data?: unknown,
  ) => Promise<{ allowed: boolean; scope?: 'persistent' | 'session'; reason?: string }>
  /** 快捷键动作执行（如 show-main-window） */
  runShortcutAction: (action: string) => void
  /** 调用通道（worker / ui；executeHostApi 注入，供通知句柄事件按通道回推） */
  channel?: HostApiChannel
  /** UI 直连视图 id（仅 UI 通道注入；worker 通道缺省；通知事件按 viewId 回推） */
  viewId?: string
  /** 授权/拒绝事件 → 对应插件日志（runtime 装配；dev 排障时把「为什么调不了」落到该插件 main.log） */
  writePluginLog?: (pluginId: string, level: 'error', message: string, data?: unknown) => void
}

/** handler 执行时 pluginId 已被注入为必填 */
export type HostApiCallContext = Omit<HostApiContext, 'pluginId'> & { pluginId: string }

export function listHostApiMethods(): string[] {
  // 方案 v2：api 目录为单一数据源
  return listApiKeys()
}

/** host-api 调用通道：worker（插件 worker 控制面） / ui（渲染层直连，docs/guides/ui-host-api.md） */
export type HostApiChannel = 'worker' | 'ui'

/**
 * UI 端可直连的 host-api 白名单（docs/guides/ui-host-api.md §3 开放清单；与 @dlient-open/api-bridge
 * 的 UI_HOST_API_PATHS 同源）。child.* 句柄操作 / app.createNative* / os.openExternal /
 * plugin.invoke 等按 §4 不开放，即使 api 表 scope 为 all 也不放行。
 */
const UI_OPEN_METHODS = new Set([
  // app
  'app.getVersion', 'app.getName', 'app.getLocale', 'app.getLocaleCountryCode', 'app.getSystemLocale',
  'app.getPreferredSystemLanguages', 'app.getPath', 'app.isActive', 'app.isHidden', 'app.notify',
  'app.data.read', 'app.data.write', 'app.crypt.encrypt', 'app.crypt.decrypt',
  // i18n / system / net
  'i18n.getLocale', 'system.getIdleState', 'net.isOnline', 'net.fetch', 'net.request',
  // dialog / notification
  'dialog.showOpenDialog', 'dialog.showSaveDialog', 'dialog.showMessageBox',
  'notification.isSupported', 'notification.send', 'notification.remove', 'notification.removeGroup',
  'notification.subscribe', 'notification.unsubscribe',
  // fs
  'fs.read', 'fs.stat', 'fs.listDir', 'fs.watch', 'fs.unwatch',
  'fs.mkdir', 'fs.write', 'fs.append', 'fs.delete', 'fs.copyDir', 'fs.lock', 'fs.unlock', 'fs.withLock',
  // clipboard
  'clipboard.readText', 'clipboard.readHTML', 'clipboard.readRTF', 'clipboard.readBookmark',
  'clipboard.readFindText', 'clipboard.readImage', 'clipboard.readBuffer', 'clipboard.read',
  'clipboard.has', 'clipboard.availableFormats',
  'clipboard.writeText', 'clipboard.writeHTML', 'clipboard.writeImage', 'clipboard.writeRTF',
  'clipboard.writeBookmark', 'clipboard.writeFindText', 'clipboard.writeBuffer', 'clipboard.write',
  'clipboard.clear',
  // permission / plugin / log
  'permission.request', 'plugin.capabilities',
  'log.write',
])

/**
 * 执行宿主方法：授权校验 → 执行。
 * @param pluginId     发起调用的插件 id（身份来源：worker 进程反查 / UI 视图登记，不信任调用方自报）
 * @param method       方法名
 * @param args         参数
 * @param capabilities 按插件授权
 * @param source       插件来源（market / local / dev）
 * @param ctx          执行上下文（跨插件调用 / 快捷键动作）
 * @param channel      调用通道：worker 通道拒绝 ui 档；UI 通道按 UI_OPEN_METHODS 白名单 + scope 校验
 */
export async function executeHostApi(
  pluginId: string,
  method: string,
  args: unknown[],
  capabilities: HostCapabilities,
  source: 'market' | 'local' | 'dev' = 'market',
  ctx: Omit<HostApiContext, 'pluginId'>,
  channel: HostApiChannel = 'worker',
  viewId?: string,
): Promise<HostApiResult> {
  // 跨插件路由（plugin.invoke）：expose + dependencies 双重校验在 runtime.invokePlugin 完成；
  // 属宿主基础能力，不入 api 目录、免 manifest.permissions 声明。
  if (method === 'plugin.invoke') {
    const [targetPluginId, targetMethod, targetArgs] = args
    return ctx.invokePlugin(pluginId, String(targetPluginId ?? ''), String(targetMethod ?? ''), Array.isArray(targetArgs) ? targetArgs : [])
  }
  // 主动预授权（plugin.requestGrant）：主进程补全调用方身份后调被调用方 grant，三态处理。
  // 属宿主基础能力，免 manifest.permissions 声明。
  if (method === 'plugin.requestGrant') {
    const [targetPluginId, targetMethod, targetData] = args
    return ctx.requestGrant(pluginId, String(targetPluginId ?? ''), String(targetMethod ?? ''), targetData)
  }
  // 方案 v2：api 目录（单一数据源：key/description/scope/level/handler）执行
  const def = getApi(method)
  if (!def) throw new DlientError(DlientErrorCode.HOST_API_NOT_FOUND, `host api not found: ${method}`)
  // 授权拒绝 → 对应插件日志（level=error；runtime 装配 writePluginLog，dev 排障时把「为什么调不了」落到该插件 main.log）
  const reportDenied = (reason: string, data?: unknown): void => {
    ctx.writePluginLog?.(pluginId, 'error', `host-api denied: ${def.key} (${reason})`, data)
  }
  // scope 校验：system 仅 system 插件可用；ui 仅 UI 端（worker 通道不可达）
  const hooks = getGrantHooks()
  if (def.scope === 'system' && !(hooks?.isSystemPlugin(pluginId) ?? false)) {
    reportDenied('system-only')
    throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `system-only host api: ${method} for plugin "${pluginId}"`)
  }
  if (channel === 'worker' && def.scope === 'ui') {
    reportDenied('ui-scope-not-reachable-from-worker')
    throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `ui-only host api not reachable from worker: ${method}`)
  }
  // UI 通道：必须在 UI 开放白名单内（docs/guides/ui-host-api.md §3），白名单之外一律拒绝
  if (channel === 'ui' && !UI_OPEN_METHODS.has(method)) {
    reportDenied('not-in-ui-open-whitelist')
    throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `ui host api not allowed: ${method}`)
  }
  // 声明校验：system 插件（含其 @dev 实例）为宿主内置/审核过的可信插件，不强制按方法声明（scope 校验已在上方把关）；
  // 非 system：声明值 = api key（manifest.permissions），兼容能力级/模块级前缀（如 app.data、app.shortcut、
  // child.spawn、plugins.dev）：manifest 权限是 def.key 的点路径前缀（def.key.startsWith(`${perm}.`)）
  // 即视为组授权放行；精确 key 同样放行。
  // dev 实例（'<id>@dev'）：能力按 manifest.source 注册在 base id 下，dev 视图以 @dev 发起调用，
  // 因此 @dev 额外继承 base id 的声明集合（仍受同一切口裁决）。
  const grantHooks = getGrantHooks()
  const isSysPlugin = grantHooks
    ? grantHooks.isSystemPlugin(pluginId) || (pluginId.endsWith('@dev') && grantHooks.isSystemPlugin(pluginId.replace(/@dev$/, '')))
    : false
  // notification.subscribe/unsubscribe：句柄事件订阅/退订仅作用于「自己发送」的通知（owner 校验在 handler 内强于声明），
  // SDK 特型自动调用不应要求插件额外声明（权限等价于已授权 notification.send 的能力），故豁免声明校验。
  const isNotificationHandleOp = method === 'notification.subscribe' || method === 'notification.unsubscribe'
  if (!isSysPlugin) {
    const granted = capabilities.getPermissions(pluginId)
    const aliasBase = pluginId.endsWith('@dev') ? capabilities.getPermissions(pluginId.replace(/@dev$/, '')) : []
    const all = granted.concat(aliasBase)
    const allowed =
      isNotificationHandleOp ||
      capabilities.canAccess(pluginId, def.key, source) ||
      all.some((p) => p === def.key || def.key.startsWith(`${p}.`))
    if (!allowed) {
      // 诊断：打印拒绝时调用方 id、目标方法与该插件（含 @dev 别名）的已授权声明，便于定位声明缺失环节
      logger.warn('security', 'host-api permission denied', {
        pluginId,
        method: def.key,
        source,
        channel,
        granted,
        grantedAliasBase: aliasBase.length ? aliasBase : undefined,
      })
      // 插件日志 data：插件来源类型用 pluginSource 键（避免与 JSONL 结构键 source=日志来源冲突）
      reportDenied('permission-not-declared', {
        pluginSource: source,
        channel,
        granted,
        grantedAliasBase: aliasBase.length ? aliasBase : undefined,
      })
      throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `permission denied: ${def.key} for plugin "${pluginId}"`)
    }
  }
  // fs.* 路径白名单强制校验（§4.1 / 修复任务 F1）：先 realpath 安全解析（最深已存在祖先 + 剩余尾缀），
  // 授权与执行共用同一解析后路径（符号链接逃逸拒绝、消除 check→use 窗口）；system 放行；拒绝写审计日志（F8）。
  const fsSpec = FS_PATH_MODE[method]
  if (fsSpec) {
    for (const i of fsSpec.args) {
      const p = args[i]
      if (typeof p === 'string' && p) {
        const safe = await resolveRealSafe(p)
        try {
          assertPathAllowed(pluginId, safe, fsSpec.mode)
        } catch (err) {
          if (err instanceof DlientError && err.code === DlientErrorCode.PERMISSION_DENIED) {
            logger.warn('security', 'fs access denied', { pluginId, method, path: p, mode: fsSpec.mode })
          }
          throw err
        }
        // 后续 handler 与 per-path 锁均以解析后路径执行（与校验一致）
        args[i] = safe
      }
    }
  }
  // 审计（todo 7.2.4）：默认关闭；开启时记录 调用方 → 方法 → 结果/错误码 → 耗时。关闭时仅一次布尔判断。
  const audit = logger.isAuditEnabled()
  const start = audit ? performance.now() : 0
  try {
    const result = await def.handler(args ?? [], { ...ctx, pluginId, channel, viewId: channel === 'ui' ? viewId : undefined })
    if (audit) {
      logger.info('audit', `${pluginId} -> ${method} ok`, { ms: roundMs(performance.now() - start) })
    }
    return result
  } catch (err) {
    if (audit) {
      const detail = errorDetail(err)
      logger.error('audit', `${pluginId} -> ${method} err`, { code: detail.code, message: detail.message, ms: roundMs(performance.now() - start) })
    }
    throw err
  }
}

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10
}
