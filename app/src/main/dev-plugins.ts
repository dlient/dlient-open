/**
 * dev-plugins.ts - 开发插件运行时管理（manifest.source === 'dev' 的插件）。
 *
 * 职责（数据层已移交 dev runtime 插件维护 plugins.json）：
 *  1. syncFromDevRuntime：dev runtime 上报完整 dev 清单后，宿主仅更新目录缓存；
 *     默认不启动 worker/watcher（由 dev-runtime 预览/刷新流程显式启停），
 *     移除条目时停止已运行的 worker + 热重载 watch（worker.js → 重启；remoteEntry/assets → 广播重载）。
 *  2. getDirInfo：协议层（dlientOpen://plugin/<id>@dev/...）定位 dev 插件实际目录。
 *  3. selectDirectory：目录选择对话框（host-api plugins.dev.selectDirectory）。
 *  4. externalRecords：从内存清单生成 PluginRecord，供 loadInstalledRecords 合并 dev 缓存。
 */

import { dialog } from 'electron'
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { PluginType } from '@dlient-open/core'
import { basePluginId, instanceKeyFor } from '@dlient-open/core'
import type { DlientRuntime } from './runtime'
import type { PluginRecord } from '../types'
import { mt } from './i18n'

/** dev runtime 上报的 dev 插件条目（plugins.json 数据结构；source 恒为 dev） */
export interface DevPluginEntry {
  id: string
  name: string
  /** 插件根目录（绝对路径，含 package.json；dist 不被拷贝） */
  path: string
  /** dist 目录相对插件根目录（manifest.dist ?? 'dist'） */
  dist: string
  version?: string
  type?: PluginType
  system?: boolean
  icon?: string
  addedAt: number
  /** 授权相关 manifest 指纹（permissions/dependencies/fsDirs/spawnCmds/expose 等；dev-tools 计算上报）。
   *  变更时宿主重启 dev worker + 广播 UI 重载，做到「即使代码未改动也刷新授权」 */
  authHash?: string
}

/** 插件目录解析结果（供协议层 / worker 定位实际文件） */
export interface PluginDirInfo {
  /** 插件根目录（绝对路径） */
  dir: string
  /** dist 子目录相对路径 */
  dist: string
}

export interface DevPluginManagerOptions {
  runtime: DlientRuntime
  /** 内置 dev 插件根目录（dev: <appRoot>/plugins；发布: <userData>/plugins） */
  pluginsRoot: () => string
  /** dev 模式本地仓库插件根目录（<appRoot>/../plugins）；协议解析时优先于 pluginsRoot */
  repoRoot?: () => string
  /** 广播插件 UI 变更（渲染层 PluginView 据此重载） */
  broadcastChange: (pluginId: string, scope: 'ui' | 'worker') => void
  /** 插件 worker 停止后回调（如清理该插件归属的 WebContentsView，防泄漏） */
  onPluginStopped?: (pluginId: string) => void
}

const DEBOUNCE_MS = 400

export interface DevPluginManager {
  /** 按插件 id 解析实际目录（dev runtime 上报优先，其次内置 pluginsRoot/<id>） */
  getDirInfo(pluginId: string): PluginDirInfo | null
  /** 是否为 dev 运行时登记的 dev 插件（协议/启动免验签判定用；dev:online 下仓库插件也命中） */
  isDevPlugin(pluginId: string): boolean
  /** 目录选择对话框（host-api plugins.dev.selectDirectory） */
  selectDirectory(): Promise<string | null>
  /** dev runtime 上报完整 dev 清单：更新缓存 + 热重载 watch + 启动/停止/重启 worker */
  syncFromDevRuntime(entries: DevPluginEntry[]): Promise<void>
  /** 停止 dev 实例 worker（'<id>@dev'；dev-runtime 刷新流程第一步） */
  stopWorker(pluginId: string): Promise<void>
  /** 重新 fork dev 实例 worker（刷新流程最后一步：install + 构建完成后） */
  startWorker(pluginId: string): Promise<void>
  /** dev 实例 worker 直连 port 是否就绪（running 状态可能早于 port-ready 握手） */
  isPortReady(pluginId: string): boolean
  /** 构建完成后显式启动热重载 watcher（先重建 → seed 当前产物状态，不触发重启）；幂等 */
  startWatcher(pluginId: string): Promise<{ ok: boolean; error?: string | { enUS: string; zhCN: string } }>
  /** 停止热重载 watcher（刷新/构建期间调用，避免构建写入触发 restart 竞态） */
  stopWatcher(pluginId: string): Promise<{ ok: boolean }>
  /** 外部 dev 插件记录（供 loadInstalledRecords 合并 dev 缓存） */
  externalRecords(): PluginRecord[]
  dispose(): void
}

export function createDevPluginManager(options: DevPluginManagerOptions): DevPluginManager {
  const { runtime, pluginsRoot, broadcastChange } = options
  /** 内存 dev 清单（由 dev runtime 上报 syncFromDevRuntime 更新） */
  const entries = new Map<string, DevPluginEntry>()
  const watchers = new Map<string, FSWatcher>()
  const debounceTimers = new Map<string, NodeJS.Timeout>()

  // ---- 目录解析（供协议/worker 定位） ----

  function getDirInfo(pluginIdOrKey: string): PluginDirInfo | null {
    // instanceKey 支持：dev 实例（'<id>@dev'）剥离后缀后按插件逻辑 id 定位目录
    const pluginId = basePluginId(pluginIdOrKey)
    const entry = entries.get(pluginId)
    if (entry) return { dir: entry.path, dist: entry.dist }
    // dev 上报未命中：dev 模式优先本地仓库 plugins 目录，其次用户数据目录
    const candidates = [options.repoRoot?.(), pluginsRoot()].filter((p): p is string => !!p)
    for (const root of candidates) {
      const dir = join(root, pluginId)
      if (existsSync(dir)) return { dir, dist: 'dist' }
    }
    return null
  }

  /** dev 运行时是否登记了该插件（entries 权威；与 worker 的 manifest.source==='dev' 豁免一致） */
  function isDevPlugin(pluginIdOrKey: string): boolean {
    return entries.has(basePluginId(pluginIdOrKey))
  }

  // ---- 热重载 watcher ----

  function stopWatch(pluginId: string): void {
    const watcher = watchers.get(pluginId)
    if (watcher) {
      watcher.close()
      watchers.delete(pluginId)
    }
    const timer = debounceTimers.get(pluginId)
    if (timer) {
      clearTimeout(timer)
      debounceTimers.delete(pluginId)
    }
  }

  /** 监听 dev 插件 dist：worker.js → 重启 worker；remoteEntry/assets → 广播 UI 重载。
   *  事件触发后校验文件 mtime/size，内容未变化视为读取/访问触发的误报并忽略
   * （Windows 上 fork/加载读取文件、杀软扫描改属性等都会产生 watch 事件）。 */
  function startWatch(pluginId: string, dir: string, dist: string): void {
    stopWatch(pluginId)
    // dev 实例以 instanceKey（'<id>@dev'）运行/广播：重启与 UI 重载按实例键路由
    const instanceKey = instanceKeyFor(pluginId, 'dev', true)
    const target = join(dir, dist)
    if (!existsSync(target)) return

    const statOf = (rel: string): { mtimeMs: number; size: number } | null => {
      try {
        const s = statSync(join(target, rel))
        return { mtimeMs: s.mtimeMs, size: s.size }
      } catch {
        return null
      }
    }
    // 已知文件状态快照（worker.js / remoteEntry.js / assets/*）
    const known = new Map<string, { mtimeMs: number; size: number }>()
    const seed = (rel: string) => {
      const s = statOf(rel)
      if (s) known.set(rel, s)
    }
    seed('worker.js')
    seed('remoteEntry.js')
    const assetsDir = join(target, 'assets')
    if (existsSync(assetsDir)) {
      for (const f of readdirSync(assetsDir)) seed(`assets/${f}`)
    }
    // 内容未变（mtime/size 一致）→ 误报，忽略
    const isSame = (rel: string): boolean => {
      const cur = statOf(rel)
      const prev = known.get(rel)
      return !!(prev && cur && prev.mtimeMs === cur.mtimeMs && prev.size === cur.size)
    }

    try {
      const watcher = watch(target, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const name = String(filename).replace(/\\/g, '/')
        // 构建中会产生一批文件事件，debounce 后统一处理
        const existing = debounceTimers.get(pluginId)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          debounceTimers.delete(pluginId)
          if (name === 'worker.js' || name.endsWith('/worker.js')) {
            if (isSame('worker.js')) return
            seed('worker.js')
            console.log(`[dev-plugins] ${instanceKey} worker.js changed, restarting worker`)
            void runtime.restartPlugin(instanceKey).then((result) => {
              const r = result as { success?: boolean; error?: string }
              if (!r?.success) console.error(`[dev-plugins] restart ${instanceKey} failed:`, r?.error)
            })
            broadcastChange(instanceKey, 'worker')
          } else if (name === 'remoteEntry.js') {
            if (isSame('remoteEntry.js')) return
            seed('remoteEntry.js')
            console.log(`[dev-plugins] ${instanceKey} UI changed (${name}), broadcasting reload`)
            broadcastChange(instanceKey, 'ui')
          } else if (name.startsWith('assets/')) {
            if (isSame(name)) return
            seed(name)
            console.log(`[dev-plugins] ${instanceKey} UI changed (${name}), broadcasting reload`)
            broadcastChange(instanceKey, 'ui')
          }
        }, DEBOUNCE_MS)
        debounceTimers.set(pluginId, timer)
      })
      watchers.set(pluginId, watcher)
    } catch (err) {
      console.error(`[dev-plugins] watch ${pluginId} failed:`, err)
    }
  }

  // ---- 目录选择 ----

  async function selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: mt('dialog.selectDevDir.title'),
      buttonLabel: mt('dialog.selectDevDir.button'),
      properties: ['openDirectory'],
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }

  // ---- dev runtime 上报同步 ----

  async function tryStartPlugin(entry: DevPluginEntry): Promise<void> {
    try {
      await runtime.startPlugin({
        id: entry.id,
        name: entry.name,
        version: entry.version ?? '0.0.0',
        enabled: true,
        source: 'dev',
        type: entry.type ?? 'full',
        system: entry.system === true,
        icon: entry.icon,
        path: entry.path,
        installedAt: entry.addedAt,
      })
    } catch (err) {
      console.error(`[dev-plugins] start ${entry.id} failed:`, err)
    }
  }

  /** 产物是否就绪（dist 下 worker.js 或 remoteEntry.js 存在）→ 才允许启 watcher。
   *  构建完成前不启动监控：worker.js 写入不会触发 restartPlugin，消除构建期间的池重启竞态。 */
  function shouldWatch(entry: DevPluginEntry): boolean {
    const target = join(entry.path, entry.dist)
    return existsSync(join(target, 'worker.js')) || existsSync(join(target, 'remoteEntry.js'))
  }

  /** dev runtime 上报完整 dev 清单（plugins.json 变更后）：仅维护目录缓存。
   *  默认不启动 worker / watcher —— 由 dev-runtime 预览/刷新流程显式启停（stopWatcher/startWatcher/startWorker）；
   *  仅「移除条目」时停止已运行的 worker 与 watcher；「目录/版本变化」时若 worker 正在运行（预览中）重启加载新产物。 */
  async function syncFromDevRuntime(nextEntries: DevPluginEntry[]): Promise<void> {
    const next = new Map<string, DevPluginEntry>()
    for (const e of nextEntries) {
      if (e && typeof e.id === 'string' && typeof e.path === 'string') next.set(e.id, e)
    }
    // 新增 / 目录或版本变化的条目：仅更新缓存；worker 正在运行（预览中）时重启以加载新产物。
    // 授权指纹（authHash）变化同样重启（刷新 permissions/fsDirs 等资源注册）并广播 UI 重载。
    for (const [id, entry] of next) {
      const prev = entries.get(id)
      const authChanged = !!entry.authHash && !!prev?.authHash && prev.authHash !== entry.authHash
      if (prev && (prev.path !== entry.path || prev.dist !== entry.dist || prev.version !== entry.version || authChanged)) {
        const instanceKey = instanceKeyFor(id, 'dev', true)
        await runtime.restartPlugin(instanceKey).catch((err) => {
          console.error(`[dev-plugins] restart ${id} failed:`, err)
        })
        if (authChanged) {
          // 授权类变更：即使代码未改动也刷新预览界面（PluginView 据此 cache-bust 重新请求，走新授权）
          broadcastChange(instanceKey, 'ui')
        }
      }
    }
    // 移除的条目：停止 worker + 停 watch
    for (const [id] of entries) {
      if (!next.has(id)) {
        const instanceKey = instanceKeyFor(id, 'dev', true)
        await runtime.stopPlugin(instanceKey).catch((err) => {
          console.error(`[dev-plugins] stop ${id} failed:`, err)
        })
        options.onPluginStopped?.(instanceKey)
        stopWatch(id)
      }
    }
    entries.clear()
    for (const [id, e] of next) entries.set(id, e)
  }

  /** 外部 dev 插件记录（供 loadInstalledRecords 合并 dev 缓存；worker/协议按外部 path 加载） */
  function externalRecords(): PluginRecord[] {
    return Array.from(entries.values()).map((entry) => ({
      id: entry.id,
      name: entry.name,
      version: entry.version ?? '0.0.0',
      enabled: true,
      source: 'dev',
      type: entry.type ?? 'full',
      system: entry.system === true,
      icon: entry.icon,
      path: entry.path,
      installedAt: entry.addedAt,
    }))
  }

  /** dev-runtime 刷新流程：显式停止 dev 实例 worker（'<id>@dev'） */
  async function stopWorker(pluginId: string): Promise<void> {
    const instanceKey = instanceKeyFor(pluginId, 'dev', true)
    await runtime.stopPlugin(instanceKey).catch((err) => {
      console.error(`[dev-plugins] stopWorker ${pluginId} failed:`, err)
    })
    options.onPluginStopped?.(instanceKey)
  }

  /** dev-runtime 刷新流程：install + 构建完成后重新 fork dev 实例 worker */
  async function startWorker(pluginId: string): Promise<void> {
    const entry = entries.get(pluginId)
    if (!entry) {
      console.error(`[dev-plugins] startWorker ${pluginId}: entry not found`)
      return
    }
    await tryStartPlugin(entry)
  }

  /** 构建完成后显式启动热重载 watcher（先 stop 重建 → seed 当前产物状态，不触发重启）；幂等 */
  async function startWatcher(pluginId: string): Promise<{ ok: boolean; error?: string | { enUS: string; zhCN: string } }> {
    const entry = entries.get(pluginId)
    if (!entry)
      return { ok: false, error: { enUS: `Dev plugin not registered: ${pluginId}`, zhCN: `dev 插件未注册: ${pluginId}` } }
    if (!shouldWatch(entry))
      return {
        ok: false,
        error: {
          enUS: `Build output not ready (no worker.js/remoteEntry.js in dist): ${pluginId}`,
          zhCN: `构建产物未就绪（dist 无 worker.js/remoteEntry.js）: ${pluginId}`,
        },
      }
    startWatch(pluginId, entry.path, entry.dist)
    return { ok: true }
  }

  /** 停止热重载 watcher（刷新/构建期间调用，避免构建写入触发 restart 竞态）；幂等 */
  async function stopWatcher(pluginId: string): Promise<{ ok: boolean }> {
    stopWatch(pluginId)
    return { ok: true }
  }

  /** dev 实例 worker 直连 port 是否就绪（dev-runtime 确认 worker 真就绪用，防「running 假成功」） */
  function isPortReady(pluginId: string): boolean {
    return runtime.isPortReady(instanceKeyFor(pluginId, 'dev', true))
  }

  // ---- 生命周期 ----

  function dispose(): void {
    for (const id of Array.from(watchers.keys())) stopWatch(id)
    entries.clear()
  }

  return { getDirInfo, isDevPlugin, selectDirectory, syncFromDevRuntime, stopWorker, startWorker, isPortReady, startWatcher, stopWatcher, externalRecords, dispose }
}
