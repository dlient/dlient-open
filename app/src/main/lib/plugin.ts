/**
 * lib/plugin.ts - plugin 模块复杂实现（方案 v2：plugins.* 系列 host-api 下沉 lib；api/plugin.ts 引用）。
 * 宿主只保留底层原语（dev 管理 / 启停 / 扫描 / 卸载清理 / 日志代理），编排在 market / dev-tools 插件内。
 * 依赖提供方经 register* 注入（export.ts 装配转发）：dev 管理、安装器 hooks、运行时 callWorker、
 * 宿主日志推送基础设施（subscribe/unsubscribe/read/clearTail）。
 * 命名切换批次将 plugins.* → plugin.*。
 */
import { app } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { DlientError, DlientErrorCode } from '@dlient-open/core'
import type { PluginType } from '@dlient-open/core'
import { copyDirRecursive } from './fs'
import { atomicWriteFile } from '../file-queue'
import { CORE_PLUGIN_IDS, upsertInstalledEntry } from '../installed-registry'
import { registerDevDirProvider, registerInstalledScanner } from './child'
import type { DevPluginEntry, DevPluginManager } from '../dev-plugins'
import type { ApiDefinition } from '../api/types'

// ---- 能力清单提供方（api/index.ts 装配末尾注入：返回 api 目录全量元数据）----
export interface CapabilityMeta {
  key: string
  description: { 'zh-CN': string; 'en-US': string }
  scope: ApiDefinition['scope']
  level: ApiDefinition['level']
}
let capsProvider: (() => CapabilityMeta[]) | null = null

export function registerPluginCapabilityProvider(fn: (() => CapabilityMeta[]) | null): void {
  capsProvider = fn
}

/** plugin.capabilities：返回 api 目录全部 key（含 scope/level/description 元数据；前端按模块前缀分组展示） */
export function listPluginCapabilities(): CapabilityMeta[] {
  return capsProvider?.() ?? []
}

// ---- dev 管理提供方（dev-plugins.ts 装配后注入；export.ts registerDevPluginManager 转发）----
let devManager: DevPluginManager | null = null

export function registerPluginDevManager(manager: DevPluginManager | null): void {
  devManager = manager
}

// ---- 安装器 hooks 提供方（export.ts registerPluginInstallerHooks 转发；market 插件编排安装/卸载）----
export interface PluginInstallerLike {
  /** 扫描已安装插件（注册表 + 目录扫描），返回统一清单 */
  scanInstalled: () => unknown[]
  /** 插件 worker 是否在运行 */
  isRunning: (pluginId: string) => boolean
  /** 启动插件 worker（读注册表找到插件记录；已运行则跳过） */
  start: (pluginId: string) => Promise<void>
  /** 停止插件 worker（含清理其归属的 WebContentsView） */
  stop: (pluginId: string) => Promise<void>
  /** 卸载收尾：清理该插件相关授权（grants）+ 广播变更（PluginView 关闭/刷新） */
  cleanupUninstall: (pluginId: string) => Promise<void>
  /** 所有实例运行时状态（含正式与 dev 双版本；dev runtime 状态同步用） */
  runtimeStates: () => unknown[]
  /** market worker 上报完整已安装清单（主动上报；宿主据此刷新缓存） */
  reportInstalled: (entries: unknown[]) => void
}

let installer: PluginInstallerLike | null = null

export function registerPluginInstaller(h: PluginInstallerLike | null): void {
  installer = h
}

// ---- 宿主 → 订阅者 worker 转发（plugins.logs.subscribe 用；export.ts setHostRuntime 转发）----
export type PluginRuntimeCall = (pluginId: string, method: string, args: unknown[]) => Promise<unknown>
let runtimeCall: PluginRuntimeCall | null = null

export function registerPluginRuntimeCall(fn: PluginRuntimeCall | null): void {
  runtimeCall = fn
}

// ---- 宿主日志推送基础设施适配（export.ts 模块装配末尾注册；与订阅表/半行缓存解耦）----
export interface PluginLogHooks {
  subscribe(target: string, onLine: (line: string) => void): { subId: string }
  unsubscribe(target: string, subId: string): boolean
  read(target: string, options: { offset?: number; maxBytes?: number }): Promise<{ lines: string[]; offset: number; reset: boolean; truncated: boolean }>
  clearTail(target: string): void
}

let logHooks: PluginLogHooks | null = null

export function registerPluginLogHooks(h: PluginLogHooks | null): void {
  logHooks = h
}

/** 目标 id 白名单：只允许逻辑 id / dev 实例键（'<id>@dev'），防路径穿越到 plugin-data 之外 */
function assertLogTarget(target: string): void {
  if (!/^[a-z0-9-]+(@dev)?$/.test(target)) {
    throw new DlientError(DlientErrorCode.INVALID, `invalid plugin id: ${target}`)
  }
}

function requireInstaller(): PluginInstallerLike {
  if (!installer) throw new DlientError(DlientErrorCode.INTERNAL, 'plugin installer hooks not registered')
  return installer
}

// ---- plugins.dev.*：目录选择 / 目录信息 / 清单同步 / dev 实例 worker / 热重载 watcher ----

/** 目录选择对话框（plugins.dev.selectDirectory） */
export function devSelectDirectory(): unknown {
  return devManager?.selectDirectory()
}

/** 按插件 id 查询 dev 目录信息（plugins.dev.getDirInfo） */
export function devGetDirInfo(pluginId: string): unknown {
  return devManager?.getDirInfo(String(pluginId)) ?? null
}

/** dev runtime 上报完整 dev 插件清单（plugins.dev.sync；只维护清单，不隐含授予任何 fs 权限） */
export function devSyncFromRuntime(entries: unknown): Promise<unknown> | undefined {
  return devManager?.syncFromDevRuntime(Array.isArray(entries) ? (entries as DevPluginEntry[]) : [])
}

/** 停止 dev 实例 worker（plugins.dev.stopDevWorker；刷新流程：install + 构建完成后 start） */
export function devStopWorker(pluginId: string): Promise<void> | undefined {
  return devManager?.stopWorker(String(pluginId ?? ''))
}

/** 重新 fork dev 实例 worker（plugins.dev.startDevWorker） */
export function devStartWorker(pluginId: string): Promise<void> | undefined {
  return devManager?.startWorker(String(pluginId ?? ''))
}

/** dev 实例 worker 直连 port 是否就绪（plugins.dev.isPortReady） */
export function devIsPortReady(pluginId: string): boolean {
  return devManager?.isPortReady(String(pluginId ?? '')) ?? false
}

/** 启动 dev 热重载 watcher（plugins.dev.startWatcher；构建完成后才启动） */
export function devStartWatcher(pluginId: string): unknown {
  return devManager?.startWatcher(String(pluginId ?? '')) ?? { ok: false, error: 'devPluginManager unavailable' }
}

/** 停止 dev 热重载 watcher（plugins.dev.stopWatcher；构建/刷新期间停止） */
export function devStopWatcher(pluginId: string): unknown {
  return devManager?.stopWatcher(String(pluginId ?? '')) ?? { ok: false, error: 'devPluginManager unavailable' }
}

/** 读取**指定**插件的自有日志（plugins.dev.readLogs；跨插件取数经 plugins.dev 约束的能力代理） */
export function devReadLogs(pluginId: string, options: unknown): Promise<{ lines: string[]; offset: number; reset: boolean; truncated: boolean }> {
  const target = String(pluginId ?? '').trim()
  assertLogTarget(target)
  const opt = (options ?? {}) as { offset?: number; maxBytes?: number }
  if (!logHooks) throw new DlientError(DlientErrorCode.INTERNAL, 'plugin log hooks not registered')
  return logHooks.read(target, { offset: opt.offset, maxBytes: opt.maxBytes })
}

/** 清空目标插件运行时日志文件（plugins.dev.clearLogs；同时重置增量读取的半行缓存） */
export async function devClearLogs(pluginId: string): Promise<void> {
  const target = String(pluginId ?? '').trim()
  assertLogTarget(target)
  logHooks?.clearTail(target)
  const mainFile = join(app.getPath('userData'), 'plugin-data', target, 'logs', 'main.log')
  await rm(mainFile, { force: true })
}

// ---- plugins.logs.*：订阅 / 取消订阅（宿主写日志后直接推送 line 给订阅者 worker）----

/** 订阅插件日志（plugins.logs.subscribe）：宿主 → 订阅者 worker 转发（dev-tools.__onPluginLog） */
export function subscribePluginLogs(target: string, caller: string): { subId: string } {
  const t = String(target ?? '').trim()
  assertLogTarget(t)
  if (!caller) throw new DlientError(DlientErrorCode.INVALID, 'caller pluginId required')
  if (!logHooks) throw new DlientError(DlientErrorCode.INTERNAL, 'plugin log hooks not registered')
  return logHooks.subscribe(t, (line) => {
    void runtimeCall?.(caller, 'dev-tools.__onPluginLog', [t, line]).catch(() => undefined)
  })
}

/** 取消订阅插件日志（plugins.logs.unsubscribe；subId 来自 subscribePluginLogs） */
export function unsubscribePluginLogs(target: string, subId: string): boolean {
  const t = String(target ?? '').trim()
  assertLogTarget(t)
  if (!logHooks) throw new DlientError(DlientErrorCode.INTERNAL, 'plugin log hooks not registered')
  return logHooks.unsubscribe(t, String(subId ?? ''))
}

// ---- 插件运行时底层能力（安装/卸载由 market 插件编排；宿主只保留原语）----

/** 系统级插件清单（plugins.system） */
export function listSystemPlugins(): unknown[] {
  const coreSet = new Set<string>(CORE_PLUGIN_IDS)
  return (installer?.scanInstalled() ?? []).filter(
    (p) => p != null && ((p as { system?: boolean }).system === true || coreSet.has(String((p as { id?: string }).id ?? ''))),
  )
}

/** 扫描已安装插件（plugins.scanInstalled） */
export function scanInstalledPlugins(): unknown[] {
  return installer?.scanInstalled() ?? []
}

/** 插件 worker 是否在运行（plugins.isRunning） */
export function isPluginRunning(pluginId: string): boolean {
  return installer?.isRunning(String(pluginId)) ?? false
}

/** 所有实例运行时状态（plugins.runtimeList） */
export function pluginRuntimeStates(): unknown[] {
  return installer?.runtimeStates() ?? []
}

/** market worker 上报完整已安装清单（plugins.registry.report；宿主据此刷新缓存，不再直接读 installed.json） */
export function reportPluginRegistry(entries: unknown): { ok: boolean } {
  requireInstaller().reportInstalled(Array.isArray(entries) ? entries : [])
  return { ok: true }
}

/** 启动插件 worker（plugins.start） */
export async function startPlugin(pluginId: string): Promise<void> {
  await requireInstaller().start(String(pluginId))
}

/** 停止插件 worker（plugins.stop） */
export async function stopPlugin(pluginId: string): Promise<void> {
  await requireInstaller().stop(String(pluginId))
}

/** 卸载收尾清理（plugins.cleanupUninstall） */
export async function cleanupUninstallPlugin(pluginId: string): Promise<void> {
  await requireInstaller().cleanupUninstall(String(pluginId))
}

/** dev-tools「导入到本地」（plugins.installLocal）：拷贝产物 + 修正 manifest + 注册 + 上报 + 启动 */
export async function installLocalPlugin(dir: unknown): Promise<{ ok: boolean; id: string; path: string }> {
  const srcDir = normalize(String(dir ?? ''))
  if (!srcDir) throw new DlientError(DlientErrorCode.INVALID, 'plugins.installLocal: dir required')
  const pkgPath = join(srcDir, 'package.json')
  let pkg: Record<string, unknown> & { name?: string; version?: string; dlient?: Record<string, unknown> }
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as typeof pkg
  } catch {
    throw new DlientError(DlientErrorCode.INVALID, 'plugins.installLocal: package.json not found or invalid')
  }
  const d = pkg.dlient
  const id = typeof d?.id === 'string' ? d.id : ''
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    throw new DlientError(DlientErrorCode.INVALID, `plugins.installLocal: invalid plugin id: ${id || '(missing)'}`)
  }
  // 目标目录：USER_DATA/plugins/<id>（先清旧，防产物残留）
  const targetDir = join(app.getPath('userData'), 'plugins', id)
  await rm(targetDir, { recursive: true, force: true })
  // 拷贝运行产物（保留 dist；排除 node_modules/.git/src/script）
  await copyDirRecursive(srcDir, targetDir, new Set(['node_modules', '.git', 'src', 'script']))
  // 修正 manifest（只写拷贝产物，不改源目录）
  const patched = { ...pkg, dlient: { ...(d ?? {}), source: 'local', system: false } }
  await atomicWriteFile(join(targetDir, 'package.json'), JSON.stringify(patched, null, 2), 'utf-8')
  // 写统一注册表（密文）+ 上报宿主缓存 + 启动
  const entry = {
    id,
    name:
      typeof d?.name === 'string'
        ? d.name
        : (d?.name as { default?: string } | undefined)?.default ?? String(pkg.name ?? id),
    version: String(pkg.version ?? '0.0.0'),
    type: (d?.type as PluginType) ?? 'app',
    source: 'local' as const,
    system: false,
    icon: typeof d?.icon === 'string' || (d?.icon && typeof d.icon === 'object') ? (d.icon as never) : undefined,
    dist: typeof d?.dist === 'string' ? d.dist : undefined,
    path: targetDir,
    addedAt: Date.now(),
  }
  await upsertInstalledEntry(entry)
  installer?.reportInstalled([entry])
  await installer?.start(id).catch(() => undefined)
  return { ok: true, id, path: targetDir }
}

// ---- 装配注入（index.ts 引入；组合转发 child 提供方 + 本模块提供方）----

/** 开发插件管理装配注入：lib/child locatePluginDist 的 dev 目录来源（native-host 入口定位用）+ 本模块 dev 管理 */
export function registerDevPluginManager(manager: DevPluginManager): void {
  registerDevDirProvider(manager ? (pluginId) => manager.getDirInfo(pluginId) : null)
  registerPluginDevManager(manager)
}

/** 插件运行时底层能力装配注入（market 插件据此编排安装 / 卸载）：lib/child 扫描来源 + 本模块安装器 */
export type PluginInstallerHooks = PluginInstallerLike
export function registerPluginInstallerHooks(hooks: PluginInstallerHooks): void {
  registerInstalledScanner(() => hooks.scanInstalled() as Array<{ id?: string; path?: string }>)
  registerPluginInstaller(hooks)
}
