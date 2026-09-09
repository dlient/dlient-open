/**
 * 主进程入口（index.ts）：窗口 / 生命周期 / dlientV3:// 协议 / 核心插件引导 / 装配。
 * 基座主进程职责仅两项：host-api（runtime/export.ts）+ 渲染层桥（bridge.ts）。
 */

import { app, BrowserWindow, protocol, session, shell, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as fs from 'node:fs'
import { PROTOCOL_NAME, parseDlientUrl, RendererChannels, getProtocolConfig, logger, basePluginId, DlientErrorCode } from '@dlient-open/core'
import type { PluginSource, PluginType } from '@dlient-open/core'
import { createRuntime, type DlientRuntime } from './runtime'
import { initMainI18n } from './i18n'
import { registerNotificationMetaProvider, registerNotificationSink, registerNotificationViewer, notifyAppEvent } from './api/notification'
import { createNotifyViewer } from './notify-viewer'
import { registerBridge, pushUiEvent } from './bridge'
import { createRuntimeConfirmDelegate } from './runtime-confirm'
import { createDialogManager } from './dialog'
import { GrantStore } from './grants'
import { ResourceGrantStore } from './resource-grants'
import { registerWindowController } from './lib/app'
import { registerDevPluginManager, registerPluginInstallerHooks } from './lib/plugin'
import { registerWebviewManager } from './lib/webview'
import { initPluginLogHooks, setHostRuntime } from './lib/log'
import { registerResourceAccessHooks } from './lib/child'
import { registerNotifyTargets } from './notify'
import { createDevPluginManager, type DevPluginManager } from './dev-plugins'
import { createWebviewManager, type WebviewManager } from './webview-manager'
import { killAllChildren, cleanupStaleChildren } from './child-registry'
import {
  pluginDirExists,
  syncPkgHashes,
  type InstalledPluginEntry,
} from './installed-registry'
import { createOrgService, type OrgLocateResult } from './org'
import { registerHostShell, initHostSettings } from './host-shell'
import { ensureMasterKey } from './crypt'
import { parseManifestIcon, type PluginRecord } from '../types'

// 数据目录：开源版统一到 <用户主目录>/.dlient-open（与闭源版 ~/.dlient 隔离，互不串数据），
// 便于备份/迁移。环境变量 DLIENT_USER_DATA 可显式覆盖（测试 / 便携场景）。须在任何 userData 读取之前设置。
const DLIENT_USER_DATA = (process.env.DLIENT_USER_DATA ?? '').trim() || path.join(app.getPath('home'), '.dlient-open')
app.setPath('userData', DLIENT_USER_DATA)
logger.info('app', 'userData set', { userData: DLIENT_USER_DATA })



const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// dlientV3:// 特权 scheme（必须在 app.whenReady() 之前注册）
protocol.registerSchemesAsPrivileged([getProtocolConfig()])

let mainWindow: BrowserWindow | null = null
/** dev 插件管理（bootstrap 装配；协议/扫描/热重载共用） */
let devPlugins: DevPluginManager | null = null
/** 插件运行时（bootstrap 装配；second-instance / open-url 协议唤起处理 OAuth 回调） */
let runtime: DlientRuntime | null = null
/** WebView 管理器（bootstrap 装配；webview 能力插件经 hostApi 调用） */
let webviewManager: WebviewManager | null = null
/** 核心插件是否已经加载 */
let pluginsReady = false

/** 窗口/任务栏图标解析：优先 asar 外的真实文件（nativeImage 可靠加载）——
 *  打包态用 extraResources 到 resources/icon.png；dev 用 public/icon.png。
 *  全部不可用/空图时返回 undefined，BrowserWindow 回退 exe 图标，避免 Electron 默认图标。 */
function windowIcon(): Electron.NativeImage | undefined {
  if (!VITE_DEV_SERVER_URL && process.resourcesPath) {
    const external = path.join(process.resourcesPath, 'icon.png')
    if (existsSync(external)) {
      const img = nativeImage.createFromPath(external)
      if (!img.isEmpty()) return img
    }
  }
  const p = VITE_DEV_SERVER_URL ? path.join(process.env.VITE_PUBLIC ?? '', 'icon.png') : path.join(app.getAppPath(), 'build', 'icon.png')
  if (!existsSync(p)) return undefined
  const img = nativeImage.createFromPath(p)
  return img.isEmpty() ? undefined : img
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'dlient',
    // 无头模式：无系统标题栏，窗口控制（关闭等）由渲染层自绘按钮经 host-api 触发
    frame: false,
    // 先隐藏：等渲染层首帧绘制完成（ready-to-show）再显示，消除"窗口先白屏 → 再出启动页"的过程
    show: false,
    // 兜底背景色：与深色主题启动页背景（hsl(240 10% 3.9%)）一致，极端情况下短暂显示也不闪白
    backgroundColor: '#09090B',
    // 窗口/任务栏图标：Windows 不支持 svg。dev 用 public/icon.png；打包态用随包 build/icon.png。
    // nativeImage 无法读 asar 内文件（会得空图，Electron 改显默认图标）→ 空图时不传，回退到 exe 图标。
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // 锁定页面缩放 100%：防止 Ctrl+滚轮等缩放导致渲染层 CSS 坐标与主进程 DIP 不一致
  //（webview bounds 由渲染层 getBoundingClientRect 测量，缩放会让宽高/偏移失真）
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  mainWindow.webContents.setZoomFactor(1)
  registerWindowController({
    close: () => mainWindow?.close(),
    focus: () => mainWindow?.focus(),
    blur: () => mainWindow?.blur(),
    show: () => mainWindow?.show(),
    hide: () => mainWindow?.hide(),
    maximize: () => mainWindow?.maximize(),
    unmaximize: () => mainWindow?.unmaximize(),
    minimize: () => mainWindow?.minimize(),
    restore: () => mainWindow?.restore(),
    setFullScreen: (flag) => mainWindow?.setFullScreen(flag),
    isMaximized: () => mainWindow?.isMaximized() ?? false,
    getWindow: () => mainWindow,
  })

  // 窗口最大化状态变化 → 广播渲染层（自绘标题栏切换 最大化/还原 图标）
  const onWindowState = () => {
    const maximized = mainWindow?.isMaximized() ?? false
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(RendererChannels.WINDOW_STATE, { maximized })
      }
    }
  }
  mainWindow.on('maximize', onWindowState)
  mainWindow.on('unmaximize', onWindowState)

  // 首帧就绪后显示窗口（需 show:false）：用户看到的第一个画面就是启动页，无白屏空窗期
  mainWindow.once('ready-to-show', () => {
    console.log('[boot] window ready-to-show')
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[boot] window did-finish-load')
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[boot] window did-fail-load code=${code} desc=${desc} url=${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[boot] renderer process gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
  mainWindow.webContents.on('preload-error', (_e, p, err) => {
    console.error(`[boot] preload-error ${p}: ${err?.message ?? err}`)
  })
  // 外部链接（http/https，如 auth 页条款/隐私策略）交给系统浏览器，不在应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  // 兜底：个别平台/GPU 异常下 ready-to-show 可能不触发，超时仍显示（backgroundColor 已保证不闪白）
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  }, 3000)

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // 竞态兜底：插件可能先于渲染层加载完成就绪（plugins-ready 已广播过），窗口加载完再补发
  mainWindow.webContents.on('did-finish-load', () => {
    if (pluginsReady && mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(RendererChannels.PLUGINS_READY)
    }
  })

  // 转发渲染进程 console → 统一日志（todo 任务 7.2.3）：生产仅转发 warn/error 避免噪音，
  // 并按 100 条/秒节流（渲染层刷屏时丢弃，防日志暴涨）
  let rendererLogCount = 0
  let rendererLogWindowStart = 0
  mainWindow.webContents.on('console-message', (_event, ...args) => {
    const params = args[0] as { message?: string; level?: string | number } | undefined
    const message = params && typeof params.message === 'string' ? params.message : String(args[1] ?? '')
    let level = typeof params?.level === 'string' ? params.level : String(args[0] ?? 'log')
    // 兼容数字 level（0=verbose..3=error）签名
    if (/^\d+$/.test(level)) level = ['verbose', 'info', 'warning', 'error'][Number(level)] ?? level
    const now = Date.now()
    if (now - rendererLogWindowStart > 1000) {
      rendererLogWindowStart = now
      rendererLogCount = 0
    }
    if (++rendererLogCount > 100) return
    // dev 排障：渲染层 console 全量直出终端
    if (VITE_DEV_SERVER_URL) console.log(`[renderer:${level}] ${message}`)
    if (level === 'error') logger.error('renderer', message)
    else if (level === 'warn' || level === 'warning') logger.warn('renderer', message)
    else if (level === 'log' || level === 'info') logger.info('renderer', message)
    else if (level === 'debug' && process.env.DLIENT_LOG_LEVEL === 'debug') logger.debug('renderer', message)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function showMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

// ---- 插件引导：插件统一安装到 <userData>/plugins ----
// dev 模式改为直接从本地仓库 plugins 目录加载（不读注册表/不访问服务端），
// 便于本地改插件 → 重建 → 重开应用即可生效；外部 dev 插件注册（selectDirectory）不受影响。
function pluginsRootDir(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

/** dev 模式本地仓库插件根目录（默认 <appRoot>/../plugins，如 E:\dlient-v3/plugins；可用 DLIENT_PLUGINS_ROOT 覆盖）。
 *  拆分多仓库后插件目录可与 app 分离存放，经环境变量显式指向；不拷贝、不持久化。 */
function repoPluginsRoot(): string {
  return process.env.DLIENT_PLUGINS_ROOT ?? path.join(process.env.APP_ROOT ?? app.getAppPath(), '..', 'plugins')
}

/** market worker 上报的已安装插件缓存（installed.json 快照；宿主不再直接读 installed.json） */
let marketCache: PluginRecord[] = []

function loadInstalledRecords(): PluginRecord[] {
  const records: PluginRecord[] = []
  const seen = new Set<string>()

  // 1) market worker 上报缓存（安装/导入/卸载后主动上报；含 source=market/local 与 system 插件）
  for (const r of marketCache) {
    if (seen.has(r.id)) continue
    records.push(r)
    seen.add(r.id)
  }

  // 2) 已安装目录扫描（userData/plugins；导入产物 source=local/market 落盘于此）。
  //    必须优先于一切 dev 记录（dev runtime 上报 / dev 仓库）：否则同 id 的 dev 副本先占位去重，
  //    会把导入的本地插件遮蔽掉（layout 又过滤 source=dev）→ 表现为重启后「上次导入的插件丢失、
  //    需重新导入」。dev 副本仅作兜底，不抢占已导入插件。
  if (existsSync(pluginsRootDir())) scanPluginDirInto(records, seen, pluginsRootDir())

  // 3) dev runtime 上报缓存（plugins.json 快照，source=dev）
  for (const r of devPlugins?.externalRecords() ?? []) {
    if (seen.has(r.id)) continue
    records.push(r)
    seen.add(r.id)
  }

  // 4) dev 仓库兜底扫描（market 未上报前的 system 插件 / dev 模式仓库内置；同 id 已被上面占位则跳过）
  //    源码树运行（dev server 或 dist-electron 直跑）时 <appRoot>/../plugins 必存在 → 兜底扫描本地仓库；
  //    打包版（app.asar）的 '..' 无 plugins 目录 → existsSync 为假，天然不扫描，保持发布语义。
  if (existsSync(repoPluginsRoot())) scanPluginDirInto(records, seen, repoPluginsRoot())
  return records
}

/** market worker 上报完整已安装清单：转 PluginRecord 存入 marketCache（主动上报；宿主不直接读 installed.json） */
function reportInstalled(entries: unknown[]): void {
  const next: PluginRecord[] = []
  for (const raw of entries) {
    const entry = raw as InstalledPluginEntry
    if (!entry || typeof entry.id !== 'string' || typeof entry.path !== 'string') continue
    if (!pluginDirExists(entry)) continue
    try {
      const pkg = JSON.parse(readFileSync(path.join(entry.path, 'package.json'), 'utf-8')) as Record<string, unknown> & {
        dlient?: Record<string, unknown>
      }
      const d = pkg.dlient ?? {}
      if (!d.id) continue
      next.push({
        id: String(d.id),
        name:
          typeof d.name === 'string'
            ? d.name
            : (d.name as Record<string, string> | undefined)?.default ?? String(pkg.name ?? entry.id),
        version: String(d.version ?? pkg.version ?? entry.version),
        enabled: d.enabled !== false,
        source: entry.source,
        type: (d.type as PluginType) ?? entry.type ?? 'ui',
        system: d.system === true || entry.system === true,
        icon: parseManifestIcon(d.icon) ?? entry.icon,
        path: entry.path,
        installedAt: entry.addedAt,
      })
    } catch {
      // 忽略无法解析的插件目录
    }
  }
  marketCache = next
  // 快照哈希同步（manifest 防篡改）：安装/导入后锚定、卸载清除；首装后不再更新
  void syncPkgHashes(next.map((r) => r.path)).catch(() => undefined)
}

/** 扫描一个插件根目录下未被注册表覆盖的插件目录，解析为 PluginRecord（目录名视为插件 id） */
function scanPluginDirInto(records: PluginRecord[], seen: Set<string>, root: string): void {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || seen.has(entry.name)) continue
    const dir = path.join(root, entry.name)
    const pkgPath = path.join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    try {
      const pkg = JSON.parse(String(readFileSync(pkgPath, 'utf-8')).replace(/^\uFEFF/, '')) as Record<string, unknown> & { dlient?: Record<string, unknown> }
      const d = pkg.dlient ?? {}
      if (!d.id) continue
      records.push({
        id: String(d.id),
        // name 支持多语言映射（dlient.name: { 'zh-CN': …, 'en-US': … }），兜底取 default / pkg.name / id
        name: typeof d.name === 'string'
          ? d.name
          : (d.name as Record<string, string> | undefined)?.default ?? String(pkg.name ?? d.id),
        version: String(d.version ?? pkg.version ?? '0.0.0'),
        enabled: d.enabled !== false,
        source: (d.source as PluginSource) ?? 'dev',
        type: (d.type as PluginType) ?? 'ui',
        system: d.system === true,
        icon: parseManifestIcon(d.icon),
        path: dir,
        installedAt: Date.now(),
      })
      seen.add(String(d.id))
    } catch {
      // 忽略无法解析的插件目录
    }
  }
}

/** 已安装插件清单（layout 侧边栏 / 市场等只读用途） */
function listInstalledPlugins(): Array<{
  id: string
  name: string
  nameL10n?: unknown
  version: string
  type: PluginType
  source: PluginSource
  system?: boolean
  icon?: string
  description?: string
  descriptionL10n?: unknown
  /** dist 是否含可加载产物（remoteEntry.js / worker.js 至少其一；dev 插件可能未打包） */
  hasDist?: boolean
  /** 插件根目录绝对路径（market 写统一注册表 installed.json 用） */
  path: string
}> {
  // F2：dev 类型插件永远不进 layout —— 清单剔除 source==='dev'（dev 插件只在 dev runtime 打开）；
  // worker 启动/协议解析不受影响（走 dev-plugins 独立列表与 dlientV3://<id>@dev 路径）。
  return loadInstalledRecords()
    .filter((r) => r.source !== 'dev')
    .map((r) => {
    let description: string | undefined
    let nameL10n: unknown
    let descriptionL10n: unknown
    let dependencies: string[] = []
    let hasDist = true
    let d:
      | {
          name?: unknown
          description?: string | Record<string, string>
          dependencies?: Record<string, string[]>
          dist?: string
          system?: boolean
        }
      | undefined
    try {
      const pkg = JSON.parse(String(readFileSync(path.join(r.path, 'package.json'), 'utf-8')).replace(/^\uFEFF/, '')) as {
        dlient?: {
          name?: unknown
          description?: string | Record<string, string>
          dependencies?: Record<string, string[]>
          dist?: string
          system?: boolean
        }
      }
      d = pkg.dlient
      nameL10n = d?.name
      descriptionL10n = d?.description
      const desc = d?.description
      description = typeof desc === 'string' ? desc : desc?.default
      // 依赖清单：manifest dlient.dependencies 的键（插件 id 列表）
      dependencies = Object.keys(d?.dependencies ?? {})
      // dist 产物校验：remoteEntry.js / worker.js 至少其一
      const distDir = path.join(r.path, d?.dist ?? 'dist')
      hasDist = existsSync(path.join(distDir, 'remoteEntry.js')) || existsSync(path.join(distDir, 'worker.js'))
    } catch {
      // 忽略：无法读取描述
    }
    return {
      id: r.id,
      name: r.name,
      nameL10n,
      version: r.version,
      type: r.type,
      source: r.source,
      // system 以目录 manifest 为准（OR 注册表值）：plugin.system 应反映「启动时实际加载的 system 插件」，
      // 插件升级/标记变更即时可见，不被 installed.json 旧快照遮蔽（否则 market 启动同步无法回写注册表，死循环）。
      system: r.system === true || d?.system === true,
      icon: r.icon,
      description,
      descriptionL10n,
      dependencies,
      hasDist,
      path: r.path,
    }
  })
}

/**
 * 核心插件就绪检查（开源版）：无服务端、无系统插件。
 * layout / setting / nodejs 已并入宿主，无需下载或写入注册表。保留函数以维持启动流程结构。
 */
async function ensureCorePlugins(): Promise<void> {
  const root = pluginsRootDir()
  if (!existsSync(root)) {
    try {
      fs.mkdirSync(root, { recursive: true })
    } catch {
      /* 目录创建失败不阻塞启动 */
    }
  }
}

/** 广播插件变更（渲染层 PluginView cache-bust 重载 / 刷新清单） */
function broadcastChange(pluginId: string, scope: string) {
  const payload = { pluginId, scope, ts: Date.now() }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(RendererChannels.PLUGIN_CHANGED, payload)
  }
}
/** 广播核心插件加载完成（基座壳据此加载 layout 主界面）；幂等，晚加载窗口由 did-finish-load 补发 */
function broadcastPluginsReady() {
  pluginsReady = true
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(RendererChannels.PLUGINS_READY)
  }
}

/** 处理外部协议唤起 URL（second-instance argv / open-url 事件送达）：开源版仅处理应用内协议之外的场景 */
function handleProtocolUrl(rawUrl: string) {
  console.log("[main]handleProtocolUrl:", rawUrl)
  try {
    const urlObj = new URL(rawUrl)
    if (urlObj.protocol !== `${PROTOCOL_NAME}:`) return
    // 开源版无 OAuth / 登录：oauth 回调路径直接忽略
    if (urlObj.hostname === 'oauth') return
  } catch (err) {
    console.error('[protocol] invalid protocol url:', rawUrl, err)
  }
}

// ---- 装配 ----

/** 确保插件 worker 启动（未运行则从已安装记录 startPlugin）；ensure-worker 与 invokePlugin 共用 */
async function ensurePluginWorker(pluginId: string): Promise<{ ok: boolean; error?: string; code?: number }> {
  if (!runtime) return { ok: false, error: 'runtime not ready', code: DlientErrorCode.INTERNAL }
  if (runtime.isRunning(pluginId)) return { ok: true }
  const baseId = basePluginId(pluginId)
  // dev 实例（'<id>@dev'）：记录不在已安装注册表，从 dev runtime 上报缓存按逻辑 id 定位并启动
  if (pluginId !== baseId) {
    const devRecord = devPlugins?.externalRecords().find((r) => r.id === baseId)
    if (devRecord) {
      try {
        await runtime.startPlugin(devRecord)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: DlientErrorCode.INSTALL_FAILED }
      }
    }
  }
  const record = loadInstalledRecords().find((r) => r.id === pluginId)
  if (record) {
    logger.info('lifecycle', 'ensure worker: start by record', { pluginId, source: record.source, path: record.path })
    try {
      await runtime.startPlugin(record)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: DlientErrorCode.INSTALL_FAILED }
    }
  }
  // dev 模式兜底：清单因缓存/去重原因漏掉仓库插件（如 core 的 nodejs）时，
  // 直接按 id 读本地仓库 <appRoot>/../plugins/<id> 启动（与 repoPluginsRoot 扫描同一数据源）。
  if (existsSync(repoPluginsRoot())) {
    const repoRecord = devRepoRecordById(pluginId)
    logger.info('lifecycle', 'ensure worker: records missed, repo fallback', {
      pluginId,
      devHost: true,
      repoRecordFound: !!repoRecord,
      repoRecord: repoRecord
        ? { id: repoRecord.id, source: repoRecord.source, path: repoRecord.path, version: repoRecord.version }
        : null,
    })
    if (repoRecord) {
      try {
        await runtime.startPlugin(repoRecord)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: DlientErrorCode.INSTALL_FAILED }
      }
    }
  } else {
    logger.info('lifecycle', 'ensure worker: records missed', { pluginId, devHost: false })
  }
  return { ok: false, error: `plugin not found: ${pluginId}`, code: DlientErrorCode.TARGET_NOT_FOUND }
}

/** dev 仓库单插件记录（按 id 读 E:<appRoot>/../plugins/<id> 的 package.json；不存在/非法返回 null） */
function devRepoRecordById(pluginId: string): PluginRecord | null {
  const baseId = basePluginId(pluginId)
  if (!/^[a-z0-9-]+$/.test(baseId)) return null
  try {
    const dir = path.join(repoPluginsRoot(), baseId)
    const pkgPath = path.join(dir, 'package.json')
    if (!existsSync(pkgPath)) return null
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown> & { dlient?: Record<string, unknown> }
    const d = pkg.dlient ?? {}
    if (String(d.id ?? '') !== baseId) return null
    return {
      id: baseId,
      name: typeof d.name === 'string' ? d.name : String(pkg.name ?? baseId),
      version: String(d.version ?? pkg.version ?? '0.0.0'),
      enabled: d.enabled !== false,
      source: (d.source as PluginSource) ?? 'dev',
      type: (d.type as PluginType) ?? 'full',
      system: d.system === true,
      icon: typeof d.icon === 'string' ? d.icon : undefined,
      path: dir,
      installedAt: Date.now(),
    }
  } catch {
    return null
  }
}

async function bootstrap() {
  // 统一日志初始化（todo 任务 7）：级别/审计开关经环境变量控制；落盘 userData/logs/main.log
  logger.init()
  logger.setLevel((process.env.DLIENT_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info')
  logger.audit(process.env.DLIENT_AUDIT_LOG === '1')
  // 阶段二：清理上次宿主退出残留的子进程（pid 文件兜底）
  await cleanupStaleChildren()
  // 预初始化 master_key：installed.json 注册表 / grants 的同步解密依赖其就绪
  await ensureMasterKey()
  // 授权表：启动时解密加载，内存常驻，仅变更时写盘（docs/v3/plugin-view.md §2.4）
  const grants = new GrantStore()
  await grants.load()
  // 资源级授权表（fs 路径白名单；dialog 授权流写入 fs-grants；session 不落盘）
  const fsGrants = new ResourceGrantStore('fs')
  await fsGrants.load()
  const netGrants = new ResourceGrantStore('net')
  await netGrants.load()
  const spawnGrants = new ResourceGrantStore('spawn')
  await spawnGrants.load()
  // 运行时授权确认：宿主主进程独占确认视图（dialog.ts WebContentsView + app/dialog/index.html），
  // 与共享渲染层隔离（插件代码不可达，无法劫持确认）；runtime-confirm.ts 负责翻译 + 结果映射
  const dialogManager = createDialogManager({ getWindow: () => mainWindow })
  const runtimeConfirmDelegate = createRuntimeConfirmDelegate(dialogManager)

  runtime = createRuntime({
    runShortcutAction: (action) => {
      if (action === 'show-main-window') showMainWindow()
    },
    ensurePluginWorker,
    grants,
    resourceGrants: { fs: fsGrants, net: netGrants, spawn: spawnGrants },
    // 进程级封禁读白名单：插件根（含 dev 仓库根）+ app node_modules + 主进程产物目录
    permissionReadDirs: [
      pluginsRootDir(),
      ...(VITE_DEV_SERVER_URL && !process.env.DLIENT_DEV_ONLINE ? [repoPluginsRoot()] : []),
      path.join(process.env.APP_ROOT ?? app.getAppPath(), 'node_modules'),
      path.join(process.env.APP_ROOT ?? app.getAppPath(), 'dist-electron'),
    ],
    runtimeConfirm: runtimeConfirmDelegate,
    // host-api 声明授权磁盘兜底：dev/本地实例 worker 未启动（无 controller）时按 id 定位磁盘记录，
    // 供 runtime 读 package.json 的 dlient.permissions 补授权（'<id>@dev' → base id 归并，见 loadInstalledRecords）
    locatePlugin: (pluginId) => loadInstalledRecords().find((r) => r.id === basePluginId(pluginId)) ?? null,
    // 包验签跳过判定：仅 dev 模式本地仓库源码目录（repoPluginsRoot）；userData/plugins 下的安装插件不豁免、始终验证
    devSourceRoots: VITE_DEV_SERVER_URL && !process.env.DLIENT_DEV_ONLINE ? [repoPluginsRoot()] : [],
  })
  // 资源级授权接入（dialog / net 授权流：fs-access / net-access 统一弹框 + grants；system 插件免确认直接授权）
  registerResourceAccessHooks({
    resourceGrants: { fs: fsGrants, net: netGrants, spawn: spawnGrants },
    confirmResource: runtimeConfirmDelegate,
    isSystemPlugin: (pluginId) => loadInstalledRecords().some((r) => r.id === pluginId && r.system === true),
    // child-event 流式推送：宿主 → 该插件 worker 的控制面（ctl1）
    sendToWorker: (instanceKey, message) => {
      runtime?.manager.getController(instanceKey)?.sendControlMessage(message)
    },
  })
  // NOTIFY 事件通知目标（宿主 → 渲染层广播；app.notify 经此分发）
  registerNotifyTargets(() => BrowserWindow.getAllWindows().map((w) => w.webContents))
  // notification v2（docs/specs/notification-v2.md）：默认值元信息 + 事件回推（worker 控制面 / UI view）装配
  registerNotificationMetaProvider((pluginId) => runtime?.getPluginMeta(pluginId) ?? null)
  registerNotificationSink((target, payload) => {
    if (target.channel === 'worker') {
      runtime?.manager.getController(target.pluginId)?.sendControlMessage({
        type: 'notification-event',
        id: payload.id,
        event: payload.event,
        payload: payload.payload,
      })
    } else {
      pushUiEvent(target.viewId, 'notification-event', { id: payload.id, event: payload.event, payload: payload.payload })
    }
  })
  registerNotificationViewer(
    createNotifyViewer({
      getWindow: () => mainWindow,
      // 交互/超时事件 → notification 注册表（registry 清理 + 句柄事件回推）
      onEvent: (id, event, payload) => notifyAppEvent(id, event, payload),
    }),
  )
  // 日志订阅推送需要宿主 → 订阅者 worker 转发（export.ts 与 runtime 解耦，装配后注入）
  setHostRuntime(runtime)
  // 装配完成后注册插件日志 host-api 适配器（顶层调用会因循环依赖触发 TDZ，见 lib/log.ts 注释）
  initPluginLogHooks()

  // 组织判定服务：resolveOrg 注入 PluginApi.organization（渲染层经 GET_PLUGIN_ORG 查询）
  // locate：正式实例走已安装清单；dev 实例（'<id>@dev'）走 dev runtime 上报；dev 模式仓库兜底。
  const orgService = createOrgService({
    locate: (pluginId: string): OrgLocateResult | null => {
      const baseId = basePluginId(pluginId)
      const record = loadInstalledRecords().find((r) => r.id === baseId)
      if (record) return { path: record.path, source: record.source }
      const dev = devPlugins?.externalRecords().find((r) => r.id === baseId)
      if (dev) return { path: dev.path, source: 'dev' }
      const repo = devRepoRecordById(baseId)
      if (repo) return { path: repo.path, source: repo.source }
      return null
    },
  })

  registerBridge(runtime, {
    getWebContents: () => mainWindow?.webContents ?? null,
    ensurePluginWorker,
    // PluginView 加载前判定插件是否已安装（render:list-plugins）
    listInstalledPlugins,
    // 插件组织解析（PluginView 挂载时注入 api.organization；render:get-plugin-org）
    resolveOrg: orgService.resolveOrg,
    // 渲染层页面就绪（宿主壳 mounted）→ 启动核心插件引导
    onRendererReady: startupCorePlugins,
    // 渲染层「重试」→ 重置启动标记重新引导（离线缺核心插件时）
    onStartupRetry: retryStartup,
  })
  // 生命周期 12.3.5-①：实例状态变更广播渲染层（controller emitStatus / restart 触发；
  // 渲染层经 preload on('plugin-status-changed') 订阅；dev runtime 亦可轮询 plugins.runtimeList）
  runtime.manager.onRuntimeChangeCallback((runtimeState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(RendererChannels.PLUGIN_STATUS, { runtime: runtimeState })
    }
  })

  // dev 插件管理：外部目录注册 + 热重载（内置主进程，发布版同样可用）
  devPlugins = createDevPluginManager({
    runtime,
    pluginsRoot: pluginsRootDir,
    // 本地开发（npm run dev）：本地仓库 plugins 目录作为协议/worker 解析的优先来源；
    // dev:online 与发布版一致：协议/worker 一律指向 userData/plugins。
    repoRoot: VITE_DEV_SERVER_URL && !process.env.DLIENT_DEV_ONLINE ? repoPluginsRoot : undefined,
    broadcastChange,
    // dev 插件 worker 停止后清理其归属的 WebContentsView（防泄漏）
    onPluginStopped: (pluginId) => webviewManager?.destroyByOwner(pluginId),
  })
  registerDevPluginManager(devPlugins)

  // 插件运行时底层能力（安装/卸载由 market 编排：落盘 + installed.json 注册表归 market，启停/授权清理归宿主）
  registerPluginInstallerHooks({
    scanInstalled: listInstalledPlugins,
    isRunning: (pluginId) => runtime!.isRunning(pluginId),
    runtimeStates: () => runtime!.listRuntimeStates(),
    reportInstalled,
    start: async (pluginId) => {
      const record = loadInstalledRecords().find((r) => r.id === pluginId)
      if (!record) throw new Error(`plugin not installed: ${pluginId}`)
      if (runtime!.isRunning(pluginId)) return
      await runtime!.startPlugin(record)
      broadcastChange(pluginId, 'installed')
    },
    stop: async (pluginId) => {
      if (!runtime!.isRunning(pluginId)) return
      await runtime!.stopPlugin(pluginId)
      // worker 已停：其归属的 WebContentsView 无法再经 worker 销毁，主进程兜底清理
      webviewManager?.destroyByOwner(pluginId)
    },
    cleanupUninstall: async (pluginId) => {
      // 卸载清理该插件相关授权（grantee 或 target 命中即清；覆盖安装保留授权，不在此清理）
      grants.revokeByPlugin(pluginId)
      broadcastChange(pluginId, 'uninstalled')
    },
  })

  // WebView 管理器：承载插件经 hostApi 创建/更新/销毁 WebContentsView，事件按 owner 转发回其 worker
  webviewManager = createWebviewManager({
    getWindow: () => mainWindow,
    callWebviewWorker: (owner, method, args) => {
      void (async () => {
        if (!runtime!.isRunning(owner)) {
          const res = await ensurePluginWorker(owner)
          if (!res.ok) return
        }
        await runtime!.callWorker(owner, method, args)
      })().catch((err) => console.error(`[webview-manager] ${method} failed:`, err))
    },
  })
  registerWebviewManager(webviewManager)

  app.on('will-quit', () => {
    // 阶段二：宿主退出 → 全量清理已登记子进程（防孤儿）
    killAllChildren()
    webviewManager?.dispose()
    devPlugins?.dispose()
    void runtime!.dispose()
  })

  // 开源版无登录：无 auth push 订阅（orgService.setUserOrgs 为占位，无实际用途）

  // 内置宿主壳（layout/setting）首方 IPC：窗口 / 菜单 / 活动归属 / 清单 / 就绪 / nodejs / .dlient 导入
  registerHostShell({
    listPlugins: listInstalledPlugins,
    reportInstalled,
    broadcastChange,
    pluginsRoot: pluginsRootDir,
    runShortcutAction: (action) => {
      if (action === 'show-main-window') showMainWindow()
    },
  })
  // 启动恢复设置（默认快捷键 / 主题 / 语言）：渲染层经 REPLAY 通道拿到初始值
  await initHostSettings().catch((err) => console.error('[settings] init failed:', err))

  // 核心插件引导：由渲染层就绪信号触发（宿主壳 mounted → render:renderer-ready）；
  // 渲染层加载失败 / 未发送就绪时 8s 超时兜底，仍按旧流程启动。
  setTimeout(startupCorePlugins, 8000)
}

// ---- 协议层资源放行（开源版）----
// 无服务端、无签名：协议层不再做完整性校验（verifyPluginPackageStartable 恒放行），
// 插件由用户自行负责。保留 ensureProtocolPluginVerified 供协议处理器调用，恒返回 true。
function ensureProtocolPluginVerified(_dir: string, _pluginId: string): Promise<boolean> {
  return Promise.resolve(true)
}

// dlientV3:// 协议磁盘映射：dlientV3://plugin/<id>/<path> → 插件目录注册表（外部 dev 插件优先）。
// 必须在 whenReady 后**最先**注册（先于 createWindow）：渲染层页面一旦开始加载就可能请求插件资源
// （layout remoteEntry / 插件 UI / CSS / 图标），协议处理器未就绪会命中 ERR_UNKNOWN_URL_SCHEME →
// SystemJS Error#3「Error loading dlientV3://…」，且一次性失败会让整个插件页永久停留错误态。
// 注意：ESM 模块必须返回正确 MIME（text/javascript），否则浏览器拒绝执行 remoteEntry；
//      net.fetch(file://) 在部分平台 MIME/流行为不稳，这里直接读文件构造 Response。
// 处理器内 devPlugins/runtime 均为模块级变量（bootstrap 装配），此处按请求时刻懒解析。
function registerDlientProtocol(): void {
  protocol.handle(PROTOCOL_NAME, async (request) => {
    try {
      // 开源版无 OAuth / 登录：oauth 协议路径直接 404（应用层协议唤起已由 handleProtocolUrl 统一忽略）
      const urlObj = new URL(request.url)
      if (urlObj.hostname === 'oauth') return new Response('Not Found', { status: 404 })

      const parsed = parseDlientUrl(request.url)
      if (!parsed) return new Response('Not Found', { status: 404 })
      const info = devPlugins?.getDirInfo(parsed.pluginId)
      if (!info) return new Response('Not Found', { status: 404 })
      // 协议层验签：篡改包（含无 worker 的 UI-only 插件）→ 拒绝提供 UI 资源
      if (!(await ensureProtocolPluginVerified(info.dir, parsed.pluginId))) {
        return new Response('Forbidden', { status: 403 })
      }
      // manifest.dist 重写：渲染层默认请求 dist/...，映射到插件声明的实际 dist 子目录
      let rel = parsed.path
      if (rel.startsWith('dist/') && info.dist !== 'dist') rel = `${info.dist}${rel.slice('dist'.length)}`
      // 2.5 协议访问控制：仅暴露 UI 产物（dist/）与插件根目录静态资源（assets/）；
      // 其余（config.json / src/** / *.pem 等）404；并精确拦截 worker.js（任意位置）与
      // *.map（sourcemap 连原始源码一起泄露）。basename 做 toLowerCase 防 Windows 大小写绕过。
      const fileBase = path.posix.basename(rel).toLowerCase()
      // 公开文档例外（旧包向后兼容）：根目录的 README（任意语言变体）与 mcp.json
      // 为说明/能力文档，无敏感信息，予以放行。新结构下 README/SKILL.md/mcp.json
      // 均在 assets/ 目录（已被 assets/ 前缀放行），此处仅为历史包兜底。
      // skills/ 目录为旧包 AI Agent 技能文档路径，同样向后兼容放行。
      const isRootDoc =
        !rel.includes('/') &&
        (fileBase === 'readme.md' || fileBase === 'readme.cn.md' || fileBase === 'readme.en.md' || fileBase === 'mcp.json')
      const isSkills = rel.startsWith('skills/')
      if (!rel.startsWith('dist/') && !rel.startsWith('assets/') && !isRootDoc && !isSkills) {
        return new Response('Not Found', { status: 404 })
      }
      if (fileBase === 'worker.js' || fileBase.endsWith('.map')) {
        return new Response('Not Found', { status: 404 })
      }
      // dist/ 等产物一律读磁盘（已统一普通打包，不再有 plugin.asar 归档内读取）
      const filePath = path.join(info.dir, rel)
      if (filePath !== info.dir && !filePath.startsWith(info.dir + path.sep)) {
        return new Response('Not Found', { status: 404 })
      }
      if (!existsSync(filePath)) {
        console.error(`[protocol] not found: ${request.url} -> ${filePath}`)
        return new Response('Not Found', { status: 404 })
      }
      const st = await fs.promises.stat(filePath)
      if (st.isDirectory()) {
        return new Response('Not Found', { status: 404 })
      }
      const ext = path.extname(filePath).toLowerCase()
      const mime =
        ext === '.js' || ext === '.mjs' ? 'text/javascript'
        : ext === '.css' ? 'text/css'
        : ext === '.html' ? 'text/html'
        : ext === '.json' ? 'application/json'
        : ext === '.svg' ? 'image/svg+xml'
        : ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.map' ? 'application/json'
        : 'application/octet-stream'
      // 异步读文件：协议层是渲染层加载插件 UI 资源的高频通道（每次插件页面加载都命中），
      // 同步 readFileSync 读大 bundle 会阻塞主进程事件循环 → 全应用 IPC/渲染停顿
      const body = await fs.promises.readFile(filePath)
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      })
    } catch (err) {
      console.error(`[protocol] error serving ${request.url}:`, err)
      return new Response('Internal Server Error', { status: 500 })
    }
  })
}

// ---- 核心插件引导（渲染层就绪后执行；幂等） ----

/** 核心插件引导是否已开始（幂等） */
let startupStarted = false

/** 核心插件引导进度广播（宿主壳启动页据此更新提示） */
function broadcastStartupProgress(
  stage: 'checking' | 'downloading' | 'installing' | 'starting' | 'ready' | 'network-error',
  detail?: string,
) {
  const payload = { stage, detail }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(RendererChannels.STARTUP_PROGRESS, payload)
  }
}

/**
 * 核心插件引导（开源版）：layout / setting / nodejs 已并入宿主，无核心插件需要下载 / 安装 / fork。
 * 仅确保插件根目录存在并广播 plugins-ready；普通（用户导入的）插件保持懒启动（ensure-worker）。
 */
async function startupCorePlugins(): Promise<void> {
  if (startupStarted) return
  startupStarted = true
  try {
    broadcastStartupProgress('checking')
    await ensureCorePlugins()
    broadcastStartupProgress('ready')
    broadcastPluginsReady()
  } catch (err) {
    console.error('[startup] core plugins bootstrap failed:', err)
    broadcastPluginsReady()
    broadcastStartupProgress('ready')
  }
}

/** 启动重试（渲染层「重试」按钮触发）：重置启动标记并重新走核心插件引导 */
function retryStartup(): void {
  startupStarted = false
  broadcastStartupProgress('checking')
  void startupCorePlugins()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ---- 单实例锁：dlientv3:// 协议唤起 / 重复启动一律转发给主实例，避免多窗口 ----
// 无锁实例（协议唤起产生的第二个进程）直接退出；主实例在 second-instance 里接管 URL。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    // Windows：协议 URL 作为命令行参数随新实例 argv 送达主实例
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL_NAME}://`))
    if (url) handleProtocolUrl(url)
  })
  // macOS / Linux：系统把协议 URL 作为 open-url 事件送达
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  app.whenReady().then(async () => {
    console.log('[boot:1] app.whenReady fired')
    // Windows 通知/任务栏归属：显式 AppUserModelId（未打包 dev 下 electron.exe 无 appId，
    // 不设置则 notification.send 返回成功但系统不弹通知）
    if (process.platform === 'win32') app.setAppUserModelId('desktop.dlient.com')
    // 主进程 i18n：以系统 locale 初始化当前语言（先于协议/窗口/插件广播）
    initMainI18n()
    console.log('[boot:2] initMainI18n done')
    // R1：渲染进程 HTML5 Notification 一律拒绝（共享渲染进程内插件 UI 不得直调系统通知，
    // 唯一出口为主进程 notification.* host-api）。permission=denied 后 new Notification() 构造即抛错。
    session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      permission === 'notifications' ? false : true,
    )
    // dlientV3:// 协议处理器最先注册（先于 createWindow）：渲染层页面一旦开始加载就可能请求插件资源，
    // 协议未就绪会命中 ERR_UNKNOWN_URL_SCHEME → SystemJS Error#3「Error loading dlientV3://…」
    registerDlientProtocol()
    console.log('[boot:3] registerDlientProtocol done')
    console.log('[boot:4] createWindow start')
    createWindow() // 先渲染基座 loading 页
    console.log('[boot:5] createWindow done')
    console.log('[boot:6] bootstrap start')
    try {
      await bootstrap() // 装配 + 启动核心插件 + 广播 plugins-ready
      console.log('[boot:7] bootstrap done')
    } catch (err) {
      console.error('[boot] bootstrap ERROR:', err)
    }
    // 诊断导出（todo 7.2.5）：--dump-logs 一键把 userData/logs/ 复制到桌面，供排障提交
    if (process.argv.includes('--dump-logs')) dumpLogsToDesktop()
  })
}

/** --dump-logs：把 userData/logs/ 复制到桌面（dlient-logs-<yyyyMMdd-HHmmss>-v<版本>） */
function dumpLogsToDesktop(): void {
  try {
    const logsDir = logger.dir() ?? path.join(app.getPath('userData'), 'logs')
    if (!existsSync(logsDir)) {
      console.log('[logs] no logs dir, nothing to dump')
      return
    }
    const ts = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
    const destDir = path.join(app.getPath('desktop'), `dlient-logs-${stamp}-v${app.getVersion()}`)
    fs.cpSync(logsDir, destDir, { recursive: true })
    console.log(`[logs] dumped to ${destDir}`)
  } catch (err) {
    console.error('[logs] dump failed:', err)
  }
}

// dlientv3:// 注册为系统默认协议（Windows 注册表）
app.removeAsDefaultProtocolClient('dlientv3')
if (!app.isPackaged && process.platform === 'win32') {
  // dev（未打包 electron.exe）：必须显式带 app 目录参数，否则唤起命令变成 electron.exe "<url>"，
  // 协议 URL 会被当作 app 路径 → 加载 default_app 空白窗口。
  app.setAsDefaultProtocolClient('dlientv3', process.execPath, [app.getAppPath()])
} else {
  app.setAsDefaultProtocolClient('dlientv3')
}
