/**
 * host-shell.ts - 内置宿主壳（layout / setting）首方 IPC 通道。
 *
 * layout / setting 并入宿主后不再是插件，无法经 worker RPC 调用宿主能力；
 * 这里提供首方（first-party）IPC：窗口控制 / 原生菜单 / 内容区活动归属 /
 * 插件清单 / 就绪检测 / nodejs 运行时 / .dlient 导入。
 * 仅注册白名单方法，不做插件级授权（宿主壳为可信首方 UI）。
 */

import { BrowserWindow, app, dialog, globalShortcut, ipcMain, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import { gunzip, inflateRaw } from 'node:zlib'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { getWindowController, popupNativeMenu } from './lib/app'
import { webviewSetActivePlugin } from './lib/webview'
import { checkBundled, checkLocal, getNodejsProgress, installNodejs, resolveRuntime, withNpmRegistry } from './nodejs'
import { upsertInstalledEntry, removeInstalledEntry, type InstalledPluginEntry } from './installed-registry'
import { listPluginCapabilities, registerPluginImportProvider } from './lib/plugin'
import { signPluginForDir, verifyPluginPackageStartable } from './org'
import { broadcastAppSetting, useSystemNativeTheme } from './lib/theme'
import { getMainLocale } from './i18n'
import { atomicWriteFile, withFileLock } from './file-queue'

const inflateRawAsync = promisify(inflateRaw)
const gunzipAsync = promisify(gunzip)

// ---- 注入依赖（index.ts 装配：避免循环 import）----

export interface HostShellDeps {
  /** 已安装插件清单（含 path，供就绪检测读 manifest） */
  listPlugins: () => Array<{
    id: string
    name: string
    version: string
    type: string
    source: string
    system?: boolean
    icon?: string
    dependencies?: string[]
    hasDist?: boolean
    path: string
  }>
  /** 安装完成上报（marketCache + syncPkgHashes） */
  reportInstalled: (entries: unknown[]) => void
  /** 插件变更广播（渲染层刷新） */
  broadcastChange: (pluginId: string, scope: string) => void
  /** 插件根目录（~/.dlient-open/plugins） */
  pluginsRoot: () => string
  /** 快捷键动作分发（'show-main-window' 等；与 runtime 装配同一入口） */
  runShortcutAction: (action: string) => void
}

let shellDeps: HostShellDeps | null = null

// ---- 设置持久化（内置 setting；~/.dlient-open/settings.json）----

interface AppSettings {
  language?: 'zh-CN' | 'en-US'
  theme?: 'light' | 'dark' | 'system'
  autoLaunch?: boolean
  shortcuts?: Record<string, string>
}

const OPEN_MAIN_SHORTCUT_ID = 'show-main-window'
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+Space'

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function loadSettings(): Promise<AppSettings> {
  return withFileLock(settingsFilePath(), async () => {
    try {
      const content = await readFile(settingsFilePath(), 'utf-8')
      return JSON.parse(content) as AppSettings
    } catch {
      return {}
    }
  })
}

/** 应用设置的系统侧副作用（主题 / 语言广播、自启动、全局快捷键）；失败不落盘由调用方决定 */
async function applySettingsSideEffects(merged: AppSettings, prev: AppSettings): Promise<void> {
  if (typeof merged.autoLaunch === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: merged.autoLaunch })
  }
  if (merged.shortcuts) {
    const prevShortcuts = prev.shortcuts ?? {}
    for (const [id, acc] of Object.entries(prevShortcuts)) {
      if (!acc || acc === (merged.shortcuts ?? {})[id]) continue
      globalShortcut.unregister(acc)
    }
    for (const [id, accelerator] of Object.entries(merged.shortcuts)) {
      if (!accelerator) continue
      try {
        globalShortcut.unregister(accelerator)
        globalShortcut.register(accelerator, () => shellDeps?.runShortcutAction(id))
      } catch {
        /* 无效 accelerator：忽略（渲染层保存前已校验） */
      }
    }
  }
  if (typeof merged.theme === 'string') {
    if (merged.theme === 'system') {
      useSystemNativeTheme(true)
    } else {
      useSystemNativeTheme(false)
      broadcastAppSetting('theme', merged.theme)
    }
  }
  if (typeof merged.language === 'string') {
    broadcastAppSetting('language', merged.language)
  }
}

async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const prev = await loadSettings()
  const merged = { ...prev, ...partial }
  await applySettingsSideEffects(merged, prev)
  await withFileLock(settingsFilePath(), () => atomicWriteFile(settingsFilePath(), JSON.stringify(merged, null, 2), 'utf-8'))
  return merged
}

/** 启动时恢复设置（默认快捷键 / 主题 / 语言）：renderer 经 REPLAY 通道拿到初始值 */
export async function initHostSettings(): Promise<void> {
  const settings = await loadSettings()
  const shortcuts = settings.shortcuts ?? {}
  if (!shortcuts[OPEN_MAIN_SHORTCUT_ID]) {
    shortcuts[OPEN_MAIN_SHORTCUT_ID] = DEFAULT_SHORTCUT
    await saveSettings({ shortcuts }).catch(() => undefined)
  } else {
    await applySettingsSideEffects(settings, {}).catch(() => undefined)
  }
}

// ---- 通道名 ----

const HOST_SHELL_CHANNEL = 'host-shell'

function handle(name: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(`${HOST_SHELL_CHANNEL}:${name}`, (_event, ...args: unknown[]) => fn(...args))
}

function requireDeps(): HostShellDeps {
  if (!shellDeps) throw new Error('host-shell not registered')
  return shellDeps
}

/** target 是否严格位于 root 目录内（含分隔符边界：<root>-evil 不算；目录本身不算）。
 *  用于卸载时判定「只允许删除安装目录下的插件」，Windows 下大小写不敏感。 */
function isInsideDir(root: string, target: string): boolean {
  const norm = (p: string): string => {
    const s = normalize(p).replace(/[/\\]+$/, '')
    return process.platform === 'win32' ? s.toLowerCase() : s
  }
  const r = norm(root)
  const t = norm(target)
  return !!r && !!t && t !== r && t.startsWith(r + sep)
}

// ---- 窗口控制（无头模式自绘标题栏）----

function windowMethod(method: 'close' | 'minimize' | 'maximize' | 'unmaximize' | 'restore' | 'setFullScreen', flag?: boolean): void {
  const wc = getWindowController()
  if (!wc) return
  if (method === 'setFullScreen') wc.setFullScreen(flag === true)
  else wc[method]()
}

export function registerHostShell(deps: HostShellDeps): void {
  shellDeps = deps

  handle('window-close', () => windowMethod('close'))
  handle('window-minimize', () => windowMethod('minimize'))
  handle('window-maximize', () => windowMethod('maximize'))
  handle('window-unmaximize', () => windowMethod('unmaximize'))
  handle('window-restore', () => windowMethod('restore'))
  handle('window-set-fullscreen', (flag: unknown) => windowMethod('setFullScreen', flag === true))
  handle('window-is-maximized', () => getWindowController()?.isMaximized() ?? false)

  handle('menu-popup', (opts: unknown) => popupNativeMenu(opts ?? {}))
  // 打开外部浏览器（layout 导入依赖 tab 的「查看 npm / github」链接；首方可信通道）
  handle('open-external', (url: unknown) => {
    const u = String(url ?? '')
    if (!/^https?:\/\//i.test(u)) throw new Error('open-external: invalid url')
    void shell.openExternal(u).catch((err) => console.error('[host-shell] openExternal failed:', err))
  })

  // 内容区活动插件归属（webview 可见性；null = 操作台）
  handle('set-active-app', (pluginId: unknown) => {
    webviewSetActivePlugin(pluginId == null || pluginId === 'console' ? null : String(pluginId))
  })

  // 插件清单（layout 侧边栏 / 操作台 / 就绪判断共用）
  handle('list-plugins', () => requireDeps().listPlugins())

  // ---- nodejs 运行时（内置；按需惰性安装）----
  handle('nodejs-status', async (opts: unknown) => {
    const v = (opts ?? {}) as { version?: string }
    const bundled = await checkBundled(v)
    const local = await checkLocal(v)
    return {
      ready: bundled.ready || local.hasNode,
      bundled: { ready: bundled.ready, version: bundled.version, satisfies: bundled.satisfies },
      local: { hasNode: local.hasNode, version: local.version, satisfies: local.satisfies },
      satisfies: (bundled.satisfies ?? false) || (local.satisfies ?? false),
    }
  })
  handle('nodejs-install', (version: unknown) => installNodejs(typeof version === 'string' ? version : undefined))
  handle('nodejs-progress', () => getNodejsProgress())
  handle('nodejs-resolve', (opts: unknown) => resolveRuntime((opts ?? {}) as { version?: string }))

  // ---- 就绪检测（BFS 依赖闭包 + nodejs；无市场 → 缺失依赖不可自动安装）----
  handle('check-readiness', async (pluginId: unknown, manifest?: unknown) =>
    checkReadiness(String(pluginId ?? ''), (manifest ?? undefined) as { dependencies?: unknown; nodeVersion?: unknown } | undefined),
  )

  // ---- .dlient 导入（layout「导入插件」）：preview 解析 manifest + 权限清单 → 渲染层确认 → install ----
  handle('preview-import-plugin', (filePath: unknown) => previewImportPlugin(typeof filePath === 'string' ? filePath : undefined))
  handle('install-import-plugin', (filePath: unknown) =>
    typeof filePath === 'string' && filePath.length > 0 ? installImportFrom(filePath) : { ok: false, error: 'missing import file' },
  )
  // npm / github / 网址 导入：与本地文件导入共用「预览 → 确认 → 安装」流程（预览缓存 token 定位临时 .dlient）
  // 注意：handle() 会剥掉 IPC event，处理函数第 1 个参数即 payload（不要再写 _event）
  handle('preview-import-source', (source: unknown) => previewImportSource(typeof source === 'string' ? source : ''))
  handle('install-import-source', (token: unknown) => installImportSource(typeof token === 'string' ? token : ''))
  handle('discard-import-source', (token: unknown) => discardImportSource(typeof token === 'string' ? token : ''))
  // plugin.install host-api 提供方：复用 .dlient 深度安装核心（同源：文件 / npm / github / URL）
  registerPluginImportProvider((req) => pluginInstallFromRequest(req))
  // 渲染层安装确认结果回填（plugin.install 用户授权）
  handle('plugin-install-confirm-result', (confirmId: unknown, ok: unknown) => {
    resolveInstallConfirm(String(confirmId ?? ''), ok === true)
  })

  // 操作台 NPM 市场：关键词 dlient-open-plugin 搜索（main 直连 registry，免渲染层 CORS/CSP）
  handle('npm-market-search', (opts: unknown) => searchNpmMarket((opts ?? {}) as NpmMarketQuery))

  // 校验插件包完整性（layout 打开前预检；@dev / dev 源码目录不受签名影响，签名损坏才报错）
  handle('verify-plugin', async (pluginId: unknown) => {
    const id = String(pluginId ?? '')
    const record = requireDeps().listPlugins().find((p) => p.id === id)
    if (!record) return { ok: false, error: `plugin not found: ${id}` }
    if (record.source === 'dev') return { ok: true }
    const v = await verifyPluginPackageStartable(record.path, id)
    return v.ok ? { ok: true } : { ok: false, reason: 'integrity', error: v.error ?? 'integrity check failed' }
  })

  // 卸载（layout 右侧菜单「卸载」；移除目录 + 注册表 + 缓存 + 广播）
  // 只允许删除安装目录（<userData>/plugins）下的插件：dev 仓库 / 用户自选目录等外部位置
  // 只做卸载登记（清注册表 + 广播），**绝不删源文件**（否则会删掉开发者的源码目录）。
  handle('uninstall-plugin', async (pluginId: unknown) => {
    const id = String(pluginId ?? '')
    if (!id || !/^[a-z0-9-]+$/.test(id)) return { ok: false, error: `invalid plugin id: ${id}` }
    const deps = requireDeps()
    const record = deps.listPlugins().find((p) => p.id === id)
    if (!record) return { ok: false, error: `plugin not installed: ${id}` }
    if (isInsideDir(deps.pluginsRoot(), record.path)) {
      await rm(record.path, { recursive: true, force: true }).catch(() => undefined)
    } else {
      console.warn(`[host-shell] uninstall ${id}: kept files outside installed root (${record.path})`)
    }
    await removeInstalledEntry(id).catch(() => undefined)
    deps.broadcastChange(id, 'uninstalled')
    return { ok: true }
  })

  // ---- 设置（内置 setting）----
  handle('settings-get', () => loadSettings())
  handle('settings-set', (partial: unknown) => saveSettings((partial ?? {}) as Partial<AppSettings>))
  handle('about', () => ({
    name: app.getName(),
    version: app.getVersion(),
    locale: app.getLocale(),
    platform: `${process.platform}.${process.arch}`,
  }))
}

// ---- 就绪检测 ----

interface ReadinessPlugin {
  id: string
  path: string
  dependencies: string[]
  nodeVersion?: string
}

/** 读插件 manifest 的依赖与 nodeVersion（path 目录下 package.json 的 dlient 段）；依赖并集含 preInstall 键 */
function readManifestRuntime(dir: string): { dependencies: string[]; nodeVersion?: string } | null {
  try {
    const pkg = JSON.parse(String(readFileSync(join(dir, 'package.json'), 'utf-8')).replace(/^\uFEFF/, '')) as {
      dlient?: { dependencies?: Record<string, unknown> | unknown[]; preInstall?: Record<string, unknown>; nodeVersion?: unknown }
    }
    const d = pkg.dlient
    if (!d) return null
    const deps = d.dependencies
    const depIds = Array.isArray(deps)
      ? deps.map((x) => String(x))
      : deps && typeof deps === 'object'
        ? Object.keys(deps as Record<string, unknown>)
        : []
    // preInstall：安装期依赖，键同样是「必须已安装的依赖插件」→ 并入就绪闭包
    const pre = d.preInstall
    if (pre && typeof pre === 'object' && !Array.isArray(pre)) {
      for (const key of Object.keys(pre)) if (!depIds.includes(key)) depIds.push(key)
    }
    const nodeVersion = typeof d.nodeVersion === 'string' ? d.nodeVersion : undefined
    return { dependencies: depIds, nodeVersion }
  } catch {
    return null
  }
}

/** 需要 nodejs 的判定：依赖声明含 nodejs，或 manifest 声明 nodeVersion */
function needsNodejs(entry: { dependencies?: string[]; nodeVersion?: string }): boolean {
  return (entry.dependencies ?? []).includes('nodejs') || typeof entry.nodeVersion === 'string'
}

/** 取较大的版本要求（"22" / ">=22"，按主版本号比较） */
function maxNodeVersion(a: string | undefined, b: string): string | undefined {
  if (!a) return b
  const pa = Number((a.match(/(\d+)/) ?? [])[1] ?? 0)
  const pb = Number((b.match(/(\d+)/) ?? [])[1] ?? 0)
  return pb > pa ? b : a
}

/** 依赖 id 列表：manifest dependencies 为对象 {id: methods} 或数组 */
function depIdsOf(deps: unknown): string[] {
  if (deps == null) return []
  if (Array.isArray(deps)) return deps.map((x) => String(x))
  if (typeof deps === 'object') return Object.keys(deps as Record<string, unknown>)
  return []
}

/** 就绪检测的依赖并集：dependencies + preInstall 键（preInstall 决定「依赖插件必须被安装」，与安装期语义一致） */
function manifestDepUnion(manifest: { dependencies?: unknown; preInstall?: unknown } | undefined): string[] {
  const a = depIdsOf(manifest?.dependencies)
  const b = depIdsOf(manifest?.preInstall)
  if (b.length === 0) return a
  return Array.from(new Set([...a, ...b]))
}

export interface ReadinessResult {
  ready: boolean
  /** 闭包中未安装的依赖（无市场可自动安装；需用户导入） */
  missingDeps: string[]
  /** 需要 nodejs 但未安装运行环境 */
  nodejsMissing: boolean
  /** 需要 nodejs 且版本不满足（需更新） */
  nodejsOutdated: boolean
  /** 闭包中声明的最高 node 版本要求（提示用） */
  nodeVersion?: string
}

/**
 * 深度就绪判断（BFS 展开「自身 + 全部依赖」闭包，排除 nodejs 运行时占位）：
 *   - 每个节点判断是否需要 nodejs（未装 / 版本不符 → 未就绪）；
 *   - 闭包中任一依赖未安装 → 未就绪（开源版无市场，缺失依赖提示用户导入）。
 * manifest 传入时（dev 预览等）根节点优先按 manifest 分析。
 */
export async function checkReadiness(
  pluginId: string,
  manifest?: { dependencies?: unknown; preInstall?: unknown; nodeVersion?: unknown },
): Promise<ReadinessResult> {
  const installed = requireDeps().listPlugins()
  const byId = new Map<string, ReadinessPlugin>()
  for (const p of installed) {
    const rt = readManifestRuntime(p.path) ?? { dependencies: [], nodeVersion: undefined }
    byId.set(p.id, { id: p.id, path: p.path, dependencies: p.dependencies ?? rt.dependencies, nodeVersion: rt.nodeVersion })
  }

  const missingDeps: string[] = []
  let nodejsMissing = false
  let nodejsOutdated = false
  let reqVersion: string | undefined

  const checkNodejs = async (nodeVersion: string | undefined, deps: string[]) => {
    if (!needsNodejs({ dependencies: deps, nodeVersion })) return
    const rt = await resolveRuntime(nodeVersion ? { version: nodeVersion } : undefined).catch(() => ({ source: 'none' as const }))
    const ok = rt.source !== 'none'
    if (!ok) {
      const local = await checkLocal().catch(() => ({ hasNode: false as const }))
      const bundled = await checkBundled().catch(() => ({ ready: false as const }))
      if (!local.hasNode && !bundled.ready) nodejsMissing = true
      else nodejsOutdated = true
    }
    if (nodeVersion) reqVersion = maxNodeVersion(reqVersion, nodeVersion)
  }

  const queue = [pluginId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const isRoot = id === pluginId
    const entry = byId.get(id)
    const deps = isRoot && manifest ? manifestDepUnion(manifest) : entry ? entry.dependencies : []
    const nodeVersion = isRoot && manifest ? (typeof manifest.nodeVersion === 'string' ? manifest.nodeVersion : undefined) : entry?.nodeVersion
    await checkNodejs(nodeVersion, deps)
    if (!entry) {
      if (!isRoot) missingDeps.push(id)
      continue
    }
    for (const d of deps) {
      if (d !== 'nodejs') queue.push(d)
    }
  }

  return {
    ready: missingDeps.length === 0 && !nodejsMissing && !nodejsOutdated,
    missingDeps,
    nodejsMissing,
    nodejsOutdated,
    nodeVersion: reqVersion,
  }
}

// ---- .dlient 导入 ----

interface ZipEntry {
  name: string
  data: Buffer
}

/** 极简 zip 解包（EOCD + 中央目录 + 本地头，支持 stored/deflate） */
async function extractZip(buffer: Buffer): Promise<ZipEntry[]> {
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('invalid plugin package: missing central directory')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('invalid plugin package: corrupt central directory')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf-8')
    if (name.endsWith('/')) {
      offset += 46 + nameLen + extraLen + commentLen
      continue
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`invalid plugin package: bad local file header (${name})`)
    }
    const lNameLen = buffer.readUInt16LE(localOffset + 26)
    const lExtraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = buffer.subarray(dataStart, dataStart + compSize)
    const raw = method === 0 ? Buffer.from(data) : method === 8 ? await inflateRawAsync(data) : null
    if (!raw) throw new Error(`unsupported compression method ${method} for ${name}`)
    entries.push({ name, data: raw })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 所有条目共享的单一根目录段（打包时常见 `<id>/` 前缀），有则剥离 */
function commonRoot(entries: ZipEntry[]): string {
  const first = entries.find((e) => !e.name.endsWith('/'))
  if (!first) return ''
  const seg = first.name.split('/')[0]
  if (!seg) return ''
  return entries.every((e) => e.name === seg || e.name.startsWith(`${seg}/`)) ? `${seg}/` : ''
}

/** 把解包条目写到目录（防路径穿越） */
async function writeEntriesToDir(dir: string, entries: ZipEntry[]): Promise<void> {
  const root = commonRoot(entries)
  const normalized = normalize(dir)
  for (const entry of entries) {
    const rel = root ? entry.name.slice(root.length) : entry.name
    if (!rel) continue
    const out = normalize(join(normalized, rel))
    if (out !== normalized && !out.startsWith(normalized + sep)) {
      throw new Error(`unsafe archive entry path: ${entry.name}`)
    }
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, entry.data)
  }
}

/** 校验原生模块声明（依赖名/版本合法性，防恶意包名逃逸） */
function validateNativeModules(nativeModules: unknown): string | null {
  const nm = nativeModules as { dependencies?: Record<string, unknown> } | null | undefined
  if (!nm || typeof nm !== 'object') return null
  const deps = nm.dependencies
  if (!deps || typeof deps !== 'object') return null
  for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) return `invalid native dependency name: ${name}`
    if (typeof version !== 'string' || !version.trim()) return `invalid native dependency version: ${name}`
  }
  return null
}

/**
 * 解析 npm 执行方式：一律优先 `node <npm-cli.js>`。
 * 不能直接 spawn `npm.cmd` —— Node ≥20 在 Windows 上 spawn `.cmd` / `.bat` 必须带 shell，
 * 否则 execFile 会**同步抛** `spawn EINVAL`（npm 拉包 / 原生模块安装会直接失败）。
 * npm-cli.js 由 resolveRuntime 的 npmCli 给出（node 同目录 node_modules/npm/bin），内置与系统运行时都可用。
 */
async function npmExecTarget(): Promise<{ cmd: string; args: string[] } | { error: string }> {
  const rt = await resolveRuntime()
  if (rt.source === 'none' || !rt.node) return { error: '未找到可用的 Node.js 运行时' }
  if (rt.npmCli) return { cmd: rt.node, args: [rt.npmCli] }
  if (process.platform === 'win32') return { error: '未找到 npm（缺少 npm-cli.js），请检查 Node.js 安装是否完整' }
  return { cmd: 'npm', args: [] }
}

/** 异步执行 npm install（原生模块；等待退出，超时 kill） */
async function npmInstall(pluginDir: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  const target = await npmExecTarget()
  if ('error' in target) return { ok: false, error: target.error }
  const npmArgs = await withNpmRegistry(['install', '--no-audit', '--no-fund', ...args])
  return await new Promise((resolve) => {
    const child = execFile(target.cmd, [...target.args, ...npmArgs], { cwd: pluginDir, timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err) => {
      if (!err) return resolve({ ok: true })
      const message = err instanceof Error ? err.message : String(err)
      resolve({ ok: false, error: message })
    })
    child.on('error', (e) => {
      resolve({ ok: false, error: e.message })
    })
  })
}

/** .dlient 导入：preview（选文件 + 解析 manifest + 权限清单）→ 渲染层权限确认 → install（解包落盘）。 */

interface ParsedImport {
  filePath: string
  entries: ZipEntry[]
  pkg: Record<string, unknown> & { version?: string; dlient?: Record<string, unknown> }
  d: Record<string, unknown>
  id: string
  name: string
  version: string
}

/** 读 .dlient 并做基础校验（manifest 存在 / id 合法 / 非 system），preview 与 install 共用；失败返回错误文案 */
async function parseImportFile(filePath: string): Promise<{ parsed: ParsedImport } | { error: string }> {
  try {
    const buf = await readFile(filePath)
    const entries = await extractZip(buf)
    const root = commonRoot(entries)
    const pkgEntry = entries.find((e) => e.name === `${root}package.json`) ?? entries.find((e) => e.name === 'package.json')
    if (!pkgEntry) return { error: '.dlient 包中未找到 package.json' }
    const pkg = JSON.parse(pkgEntry.data.toString('utf-8')) as ParsedImport['pkg']
    const d = pkg.dlient
    if (!d || typeof d !== 'object') return { error: '未找到有效的插件 manifest（package.json 的 dlient.id）' }
    const id = String(d.id ?? '')
    if (!id || !/^[a-z0-9-]+$/.test(id)) return { error: `插件 ID 不合法：${id || '(缺失)'}` }
    if (d.system === true) return { error: '系统插件不允许通过导入安装' }
    const version = String(d.version ?? pkg.version ?? '0.0.0')
    const name = typeof d.name === 'string' ? d.name : (d.name as { default?: string } | undefined)?.default ?? id
    return { parsed: { filePath, entries, pkg, d, id, name, version } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/** 选择 .dlient 文件（用户取消返回 null） */
async function pickImportFile(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const picked = await dialog.showOpenDialog(win, {
    title: '导入 .dlient 插件',
    properties: ['openFile'],
    filters: [{ name: 'dlient package', extensions: ['dlient'] }],
  }).catch(() => null)
  return picked?.filePaths?.[0] ?? null
}

/** 权限展示项：key + 风险级别 + 本地化描述（未知 key 的 description 为 null，UI 按 key 兜底展示） */
interface ImportPermItem {
  key: string
  level: string
  description: { 'zh-CN': string; 'en-US': string } | null
}

/** preInstall 依赖项：plugin id → 安装源；kind 决定安装/展示方式 */
interface ImportDepItem {
  id: string
  /** 原始配置（semver / github 地址 / .dlient 直链） */
  source: string
  /** npm（semver） / github（release 找 .dlient） / url（.dlient 直链下载） */
  kind: 'npm' | 'github' | 'url'
}

type ImportResult = { ok: boolean; id?: string; name?: string; version?: string; exists?: boolean; error?: string }
type ImportPreviewResult =
  | {
      ok: true
      preview: {
        filePath: string
        id: string
        name: string
        version: string
        type?: string
        description?: string
        permissions: ImportPermItem[]
        preInstall: ImportDepItem[]
      }
    }
  | { ok: false; error: string }
  | null

/** 判定 preInstall 值类型：https(github.com) → github；https(*.dlient) → url；其余（含 http 非 dlient）按 npm 语义 */
function classifyPreInstall(raw: string): ImportDepItem['kind'] {
  const v = String(raw ?? '').trim()
  if (/^https?:\/\//i.test(v)) {
    try {
      const host = new URL(v).hostname.toLowerCase()
      if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
    } catch {
      /* 非法 URL 按 npm 处理 */
    }
    // 其余 http(s) 一律按直接文件下载处理（.dlient 或任意可下载文件）
    return 'url'
  }
  return 'npm'
}

/** 解析 manifest preInstall（{ id: source } 对象）为有序依赖列表 */
function parsePreInstall(d: Record<string, unknown>): ImportDepItem[] {
  const raw = d.preInstall
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const list: ImportDepItem[] = []
  for (const [id, value] of Object.entries(raw)) {
    if (!/^[a-z0-9-]+$/.test(id)) continue
    if (typeof value !== 'string' || !value.trim()) continue
    list.push({ id, source: value.trim(), kind: classifyPreInstall(value) })
  }
  return list
}

/**
 * manifest 本地化文本字段（如 dlient.description 的 { default, 'zh-CN', 'en-US' }）：
 * 按主进程当前语言取值，缺失回退 default；纯字符串原样返回。
 */
function pickLocalized(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const rec = value as Record<string, unknown>
  const hit = rec[getMainLocale()] ?? rec.default
  return typeof hit === 'string' && hit.trim() ? hit : undefined
}

/** 由已解析的导入包生成预览对象（权限 + preInstall 依赖清单）；本地文件与 npm/github/网址导入共用 */
function buildImportPreview(parsed: ParsedImport): {
  id: string
  name: string
  version: string
  type?: string
  description?: string
  permissions: ImportPermItem[]
  preInstall: ImportDepItem[]
} {
  const d = parsed.d
  const rawPerms = d.permissions
  const perms = Array.isArray(rawPerms) ? rawPerms.map((x) => String(x)) : []
  const capByKey = new Map(listPluginCapabilities().map((c) => [c.key, c]))
  const desc = d.description
  return {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version,
    type: typeof d.type === 'string' ? d.type : undefined,
    description: pickLocalized(desc),
    permissions: perms.map((key) => {
      const meta = capByKey.get(key)
      return { key, level: meta?.level ?? 'default', description: meta?.description ?? null }
    }),
    preInstall: parsePreInstall(d),
  }
}

/**
 * preview：解析 manifest + 权限/依赖清单（不落盘）。
 * 传入 filePath（拖入的文件）时直接解析；未传则弹系统文件选择框，用户取消返回 null。
 */
async function previewImportPlugin(filePath?: string): Promise<ImportPreviewResult> {
  const target = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : await pickImportFile()
  if (!target) return null
  const r = await parseImportFile(target)
  if ('error' in r) return { ok: false, error: r.error }
  return { ok: true, preview: { filePath: target, ...buildImportPreview(r.parsed) } }
}

// ---- preInstall 深度安装：manifest 声明依赖（npm semver / github release / .dlient 直链）----

/** 极简 tar 解析（ustar；npm 包产物）：仅返回常规文件（name 已去 ./ 前缀） */
function parseTar(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  const readField = (block: Buffer, offset: number, len: number): string => {
    const end = block.indexOf(0, offset)
    const to = end >= offset && end < offset + len ? end : offset + len
    return block.subarray(offset, to).toString('utf-8')
  }
  const files: Array<{ name: string; data: Buffer }> = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const block = buffer.subarray(offset, offset + 512)
    if (block.every((b) => b === 0)) break
    const name = readField(block, 0, 100)
    const prefix = readField(block, 345, 155)
    const size = parseInt(readField(block, 124, 12).trim() || '0', 8) || 0
    const typeflag = String.fromCharCode(block[156])
    const fullName = `${prefix ? `${prefix}/` : ''}${name}`.replace(/^\.\//, '')
    const dataStart = offset + 512
    offset = dataStart + Math.ceil(size / 512) * 512
    if ((typeflag === '0' || typeflag === '\0') && fullName && !fullName.endsWith('/')) {
      files.push({ name: fullName, data: Buffer.from(buffer.subarray(dataStart, dataStart + size)) })
    }
    if (name === '' && block.every((b) => b === 0)) break
  }
  return files
}

/** 去掉 npm 包顶层目录（通常 'package/'）；无公共顶层目录时原样返回 */
function stripTarballRoot(files: Array<{ name: string; data: Buffer }>): Array<{ name: string; data: Buffer }> {
  const first = files[0]?.name
  const seg = first?.split('/')[0]
  const under = !!seg && files.every((f) => f.name.startsWith(`${seg}/`))
  if (!under) return files
  return files.map((f) => ({ name: f.name.slice(seg.length + 1), data: f.data }))
}

/** 从 npm 包内容中挑 .dlient 产物：包根目录优先，其次 pack/、dist/（spec：根目录或 dist/pack 目录内） */
function pickDlientFromNpmPkg(files: Array<{ name: string; data: Buffer }>): Buffer | null {
  const stripped = stripTarballRoot(files)
  const candidates = stripped.filter((f) => f.name.toLowerCase().endsWith('.dlient'))
  if (candidates.length === 0) return null
  const rank = (name: string): number => {
    if (!name.includes('/')) return 0 // 根目录
    if (name.startsWith('pack/')) return 1
    if (name.startsWith('dist/')) return 2
    return 3
  }
  candidates.sort((a, b) => rank(a.name) - rank(b.name))
  return candidates[0].data
}

/** 执行 npm 命令（沿用内置 node 运行时 + 地区 registry），捕获 stdout/stderr */
async function runNpmCapture(
  args: string[],
  cwd: string,
  timeoutMs = 180000,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const target = await npmExecTarget()
  if ('error' in target) return { ok: false, stdout: '', stderr: target.error, code: null }
  const npmArgs = await withNpmRegistry(args)
  return await new Promise((resolve) => {
    const child = execFile(target.cmd, [...target.args, ...npmArgs], { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: 0 })
      const code = typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null
      resolve({ ok: false, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code })
    })
    child.on('error', (e) => resolve({ ok: false, stdout: '', stderr: e.message, code: null }))
  })
}

/** 超时信号（AbortController；兼容性比 AbortSignal.timeout 更好） */
function fetchTimeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return ctrl.signal
}

/** 通用下载到临时目录文件（fetch 跟随重定向；失败抛错误文案） */
async function downloadToTempFile(url: string, dir: string, name: string): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'dlient-open' },
    signal: fetchTimeoutSignal(180000),
  }).catch(() => null)
  if (!res || !res.ok || !res.body) {
    throw new Error(`下载失败（HTTP ${res?.status ?? 'ERR'} ${res?.statusText ?? url}）`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const out = join(dir, name)
  await writeFile(out, buf)
  return out
}

/** npm pack 拉包 → 解 tar → 去顶层目录 → 返回包内容文件列表（失败返回错误文案） */
async function npmPackEntries(
  depId: string,
  spec: string,
): Promise<{ ok: true; entries: Array<{ name: string; data: Buffer }> } | { ok: false; error: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dlient-npm-'))
  try {
    const npmSpec = spec === 'latest' || spec === '*' || !spec ? depId : `${depId}@${spec}`
    const pack = await runNpmCapture(['pack', npmSpec, '--pack-destination', dir, '--no-audit', '--no-fund', '--loglevel', 'error'], dir)
    if (!pack.ok) return { ok: false, error: `npm 拉取失败（${depId}@${spec}）：${(pack.stderr || pack.stdout).slice(-300)}` }
    const tgzFiles = (await readdir(dir)).filter((f) => f.endsWith('.tgz'))
    if (tgzFiles.length === 0) return { ok: false, error: `npm 拉取失败（${depId}@${spec}）：未得到 tarball` }
    const tgz = await readFile(join(dir, tgzFiles[0]))
    const tar = await gunzipAsync(tgz)
    return { ok: true, entries: stripTarballRoot(parseTar(tar)) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** preInstall → npm（semver）：npm pack 拉包 → tar 内根/dist/pack 找 .dlient → 落临时文件 */
async function resolveNpmDepToFile(depId: string, spec: string): Promise<string> {
  const r = await npmPackEntries(depId, spec)
  if (!r.ok) throw new Error(r.error)
  const content = pickDlientFromNpmPkg(r.entries)
  if (!content) throw new Error(`npm 包 ${depId} 内未找到 .dlient 产物（已查找包根目录及 dist/ pack/ 目录）`)
  const dir = await mkdtemp(join(tmpdir(), 'dlient-npm-'))
  try {
    // scoped 包名含 '/'，作为临时文件名会变成子目录 → 统一替换为 '_'
    const out = join(dir, `${depId.replace(/[\\/]/g, '_')}.dlient`)
    await writeFile(out, content)
    return out
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

/**
 * npm 源解析（供「npm 导入插件」使用）：
 * - 包内含 .dlient 产物 → { kind:'file' }（调用方在 finally 清理临时目录）；
 * - 包本身是插件工程（package.json 含 dlient manifest）→ { kind:'parsed' }（entries 在内存，无需清理）；
 * - 两者皆非 → { kind:'error' }
 */
async function resolveNpmSource(
  depId: string,
  spec: string,
): Promise<{ kind: 'file'; filePath: string } | { kind: 'parsed'; parsed: ParsedImport } | { kind: 'error'; error: string }> {
  const r = await npmPackEntries(depId, spec)
  if (!r.ok) return { kind: 'error', error: r.error }
  const { entries } = r
  const dlient = entries.find((e) => e.name.toLowerCase().endsWith('.dlient'))
  if (dlient) {
    const dir = await mkdtemp(join(tmpdir(), 'dlient-npm-'))
    try {
      const filePath = join(dir, `${depId.replace(/[\\/]/g, '_')}.dlient`)
      await writeFile(filePath, dlient.data)
      return { kind: 'file', filePath }
    } catch (err) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      return { kind: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  }
  const pkgEntry = entries.find((e) => e.name === 'package.json')
  let pkg: ParsedImport['pkg'] | null = null
  try {
    pkg = pkgEntry ? (JSON.parse(pkgEntry.data.toString('utf-8')) as ParsedImport['pkg']) : null
  } catch {
    pkg = null
  }
  const d = pkg?.dlient
  if (!d || typeof d !== 'object') {
    return { kind: 'error', error: `npm 包 ${depId} 内未找到 .dlient 产物，且 package.json 无 dlient 插件 manifest` }
  }
  const id = String(d.id ?? '')
  if (!id || !/^[a-z0-9-]+$/.test(id)) return { kind: 'error', error: `npm 包 ${depId} 的插件 ID 不合法：${id || '(缺失)'}` }
  const version = String(d.version ?? pkg?.version ?? '0.0.0')
  const dname = d.name
  const name = typeof dname === 'string' ? dname : (dname as { default?: string } | undefined)?.default ?? id
  return { kind: 'parsed', parsed: { filePath: '', entries, pkg: pkg as ParsedImport['pkg'], d, id, name, version } }
}

/** preInstall → github：取仓库最新 Release 中名为 *.dlient 的资产并下载 */
async function resolveGithubDepToFile(repoUrl: string): Promise<string> {
  const m = /github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(repoUrl)
  if (!m) throw new Error(`GitHub 地址无法解析：${repoUrl}`)
  const owner = m[1]
  const repo = m[2].replace(/\.git$/, '')
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dlient-open', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: fetchTimeoutSignal(60000),
  }).catch(() => null)
  if (!res || !res.ok) {
    throw new Error(`GitHub Release 获取失败（HTTP ${res?.status ?? 'ERR'}）：请确认仓库 ${owner}/${repo} 存在且已发布 Release`)
  }
  const json = (await res.json()) as { assets?: Array<{ name?: string; browser_download_url?: string }> }
  const asset = (json.assets ?? []).find((a) => a.name?.toLowerCase().endsWith('.dlient'))
  if (!asset?.browser_download_url) {
    throw new Error(`仓库 ${owner}/${repo} 的最新 Release 未包含 .dlient 安装包资产`)
  }
  const dir = await mkdtemp(join(tmpdir(), 'dlient-gh-'))
  try {
    return await downloadToTempFile(asset.browser_download_url, dir, `${repo}.dlient`)
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

/** preInstall → url：直接下载 .dlient 文件 */
async function resolveUrlDepToFile(url: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dlient-url-'))
  try {
    const name = url.split('/').pop()?.split('?')[0] || 'dep.dlient'
    return await downloadToTempFile(url, dir, name.toLowerCase().endsWith('.dlient') ? name : 'dep.dlient')
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

/** 下载/解析一个 preInstall 依赖到 .dlient 临时文件并按需递归安装 */
async function deepInstallDep(dep: ImportDepItem, visited: Set<string>): Promise<ImportResult> {
  let tmpPath: string | null = null
  try {
    tmpPath =
      dep.kind === 'npm'
        ? await resolveNpmDepToFile(dep.id, dep.source)
        : dep.kind === 'github'
          ? await resolveGithubDepToFile(dep.source)
          : await resolveUrlDepToFile(dep.source)
    const r = await installPackageFile(tmpPath, visited)
    return r.ok ? { ok: true, id: r.id, name: r.name, version: r.version } : r
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (tmpPath) await rm(dirname(tmpPath), { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 核心导入（含深度安装）：先装自身 preInstall 依赖（visited 防环/去重），再解包落盘自身；parsed 来自 .dlient 或 npm 插件工程 */
async function installParsedImport(parsed: ParsedImport, visited: Set<string>): Promise<ImportResult> {
  const { pkg, d, id, name, version, entries } = parsed
  visited.add(id)

  // 0) 深度安装 preInstall 依赖（先装依赖后装自身；已安装 / 处理中的跳过）
  for (const dep of parsePreInstall(d)) {
    if (visited.has(dep.id)) continue
    visited.add(dep.id)
    if (requireDeps().listPlugins().some((p) => p.id === dep.id)) continue // 已装同 id：不覆盖
    const depRes = await deepInstallDep(dep, visited)
    if (!depRes.ok) return { ok: false, error: `依赖 ${dep.id} 安装失败：${depRes.error ?? ''}` }
  }

  // 覆盖安装：先清旧目录（防产物残留）
  const deps = requireDeps()
  const targetDir = join(deps.pluginsRoot(), id)
  await rm(targetDir, { recursive: true, force: true })
  await writeEntriesToDir(targetDir, entries)

  // 修正 manifest（source=local / system=false；不保留包内可能存在的签名相关字段语义）
  const patched = { ...pkg, dlient: { ...d, source: 'local', system: false } }
  await writeFile(join(targetDir, 'package.json'), JSON.stringify(patched, null, 2), 'utf-8')

  // 原生模块：声明 nativeModules 时先确保 node 运行时，再 npm install
  const nativeModules = d.nativeModules as { dependencies?: Record<string, string> } | undefined
  if (nativeModules?.dependencies) {
    const declErr = validateNativeModules(nativeModules)
    if (declErr) return { ok: false, error: declErr }
    const rt = await resolveRuntime(typeof d.nodeVersion === 'string' ? { version: String(d.nodeVersion) } : undefined)
    if (rt.source === 'none') {
      const ins = await installNodejs(typeof d.nodeVersion === 'string' ? String(d.nodeVersion) : undefined)
      if (!ins.ok) return { ok: false, error: `Node.js 运行时安装失败：${ins.error ?? ''}` }
    }
    const npm = await npmInstall(targetDir, Object.entries(nativeModules.dependencies).map(([n, v]) => `${n}@${v}`))
    if (!npm.ok) return { ok: false, error: `原生模块安装失败：${npm.error ?? ''}` }
  }

  // 本地签名（signature.json，格式与闭源一致）：改写后的 manifest（source=local/system=false）+ dist 参与签名
  const signed = await signPluginForDir(targetDir, id, version)
  if (!signed.ok) return { ok: false, error: `插件本地签名失败：${signed.error ?? ''}` }

  // 注册表 + 上报 + 广播
  const entry: InstalledPluginEntry = {
    id,
    name,
    version,
    type: (d.type as InstalledPluginEntry['type']) ?? 'ui',
    source: 'local',
    system: false,
    icon: typeof d.icon === 'string' ? d.icon : undefined,
    dist: typeof d.dist === 'string' ? d.dist : undefined,
    path: targetDir,
    addedAt: Date.now(),
  }
  await upsertInstalledEntry(entry)
  deps.reportInstalled([entry])
  deps.broadcastChange(id, 'installed')
  return { ok: true, id, name, version, exists: pkg.source === 'market' }
}

/** install（.dlient 文件）：解析 → 深度安装 */
async function installPackageFile(filePath: string, visited: Set<string>): Promise<ImportResult> {
  const r = await parseImportFile(filePath)
  if ('error' in r) return { ok: false, error: r.error }
  return installParsedImport(r.parsed, visited)
}

/** install：执行导入（深度安装依赖 + 解包落盘 → 原生模块 → 注册表 → 上报 → 广播）；filePath 来自 preview 确认 */
async function installImportFrom(filePath: string): Promise<ImportResult> {
  return installPackageFile(filePath, new Set<string>())
}

// ---- plugin.install host-api（插件可见安装入口；复用 installPackageFile 深度安装核心）----

/** 自动判定安装源类型（无 scheme → npm；github.com → github；其它 http(s) → url 直下） */
function detectInstallSourceKind(source: string): 'npm' | 'github' | 'url' {
  if (/^https?:\/\//i.test(source)) {
    try {
      const host = new URL(source).hostname.toLowerCase()
      if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
    } catch {
      /* 非法 URL 按 npm */
    }
    return 'url'
  }
  return 'npm'
}

/** 解析 npm 引用 '<pkg>@<spec>'（含 scoped '@scope/name@ver'）；无版本视为 latest */
function parseNpmRef(ref: string): { name: string; spec: string } {
  const at = ref.lastIndexOf('@')
  if (at > 0) return { name: ref.slice(0, at), spec: ref.slice(at + 1) }
  return { name: ref, spec: 'latest' }
}

// ---- plugin.install 用户确认（宿主主窗口渲染层弹框 → 结果回填）----

interface InstallConfirmPayload {
  id: string
  kind: 'file' | 'npm' | 'github' | 'url'
  source: string
  description: string
}

const pendingInstallConfirms = new Map<string, (ok: boolean) => void>()
let installConfirmSeq = 0

function resolveInstallConfirm(confirmId: string, ok: boolean): void {
  const fn = pendingInstallConfirms.get(confirmId)
  if (!fn) return
  pendingInstallConfirms.delete(confirmId)
  fn(ok)
}

/** 请求渲染层弹出「安装确认」框；无可用窗口 / 超时视为取消 */
function requestInstallConfirm(payload: InstallConfirmPayload): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve(false)
  const confirmId = `pi-${++installConfirmSeq}-${Date.now()}`
  return new Promise((resolve) => {
    pendingInstallConfirms.set(confirmId, resolve)
    win.webContents.send('host-shell:plugin-install-confirm', { confirmId, payload })
    setTimeout(() => {
      if (pendingInstallConfirms.delete(confirmId)) resolve(false)
    }, 180000)
  })
}

/** 解析 npm 安装源：source 为 '<pkg>@<spec>' 时按全引用，否则视为 id 的版本（latest 兜底） */
function npmNameSpec(id: string, source: string): { name: string; spec: string } {
  if (source.includes('@') && !source.startsWith('@')) {
    const parsed = parseNpmRef(source)
    return { name: parsed.name, spec: parsed.spec }
  }
  const spec = source.trim() === '' || source.trim() === 'latest' || source.trim() === '*' ? 'latest' : source.trim()
  return { name: id, spec }
}

/** plugin.install 实现：参数全必填；先经渲染层用户确认，确认后才真实安装 */
async function pluginInstallFromRequest(req: {
  id?: string
  kind?: 'file' | 'npm' | 'github' | 'url'
  source?: string
  description?: string
}): Promise<ImportResult> {
  const id = typeof req?.id === 'string' ? req.id.trim() : ''
  const rawKind = req?.kind
  const source = typeof req?.source === 'string' ? req.source.trim() : ''
  const description = typeof req?.description === 'string' ? req.description.trim() : ''
  const kind: 'file' | 'npm' | 'github' | 'url' =
    rawKind === 'file' || rawKind === 'npm' || rawKind === 'github' || rawKind === 'url' ? rawKind : detectInstallSourceKind(source)
  if (!id) return { ok: false, error: 'plugin.install: id required' }
  if (!source) return { ok: false, error: 'plugin.install: source required' }
  if (!description) return { ok: false, error: 'plugin.install: description required' }

  // 用户确认（主窗口弹框；取消/超时 → 拒绝安装）
  const confirmed = await requestInstallConfirm({ id, kind, source, description })
  if (!confirmed) return { ok: false, error: '安装已取消（用户未确认）' }

  try {
    if (kind === 'file') {
      // 本地 .dlient 路径（无临时文件，无需清理）
      return await installPackageFile(source, new Set<string>())
    }
    let tmpPath: string
    if (kind === 'github') tmpPath = await resolveGithubDepToFile(source)
    else if (kind === 'url') tmpPath = await resolveUrlDepToFile(source)
    else {
      const { name, spec } = npmNameSpec(id, source)
      tmpPath = await resolveNpmDepToFile(name, spec)
    }
    try {
      return await installPackageFile(tmpPath, new Set<string>())
    } finally {
      await rm(dirname(tmpPath), { recursive: true, force: true }).catch(() => undefined)
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---- npm / github / 网址 导入（操作台「导入插件」输入源；复用 installPackageFile 深度安装核心）----

type ImportSourcePreviewBody = {
  id: string
  name: string
  version: string
  type?: string
  description?: string
  permissions: ImportPermItem[]
  preInstall: ImportDepItem[]
}

type ImportSourcePreviewResult =
  | {
      ok: true
      /** 预览缓存 token：确认安装 / 取消清理时凭此定位临时 .dlient */
      token: string
      kind: 'npm' | 'github' | 'url'
      source: string
      preview: ImportSourcePreviewBody
    }
  | { ok: false; error: string }

/** 已解析的导入源：.dlient 临时文件（file，安装/取消后需清理）或 npm 插件工程（parsed，entries 在内存） */
type ResolvedImportSource = { type: 'file'; filePath: string } | { type: 'parsed'; parsed: ParsedImport }

/** 预览后的临时 .dlient 缓存（token → 解析结果）：安装成功后清理；未安装则 TTL 到期清理，避免泄漏临时文件 */
const pendingSourceImports = new Map<string, { kind: 'npm' | 'github' | 'url'; source: string; resolved: ResolvedImportSource }>()
let pendingSourceSeq = 0
const PENDING_SOURCE_TTL_MS = 10 * 60 * 1000

function dropSourceImport(token: string): void {
  const ent = pendingSourceImports.get(token)
  if (!ent) return
  pendingSourceImports.delete(token)
  if (ent.resolved.type === 'file') {
    void rm(dirname(ent.resolved.filePath), { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 解析 npm / github / 网址 源 → 得到可安装的 .dlient 临时文件或 npm 插件工程（失败抛错误文案） */
async function resolveImportSource(source: string, kind: 'npm' | 'github' | 'url'): Promise<ResolvedImportSource> {
  if (kind === 'npm') {
    const { name, spec } = parseNpmRef(source)
    const r = await resolveNpmSource(name, spec)
    if (r.kind === 'error') throw new Error(r.error)
    return r.kind === 'file' ? { type: 'file', filePath: r.filePath } : { type: 'parsed', parsed: r.parsed }
  }
  if (kind === 'github') return { type: 'file', filePath: await resolveGithubDepToFile(source) }
  return { type: 'file', filePath: await resolveUrlDepToFile(source) }
}

/** preview：解析 npm / github / 网址 源 → 拉取 .dlient 临时文件或 npm 插件工程 → 与本地文件同款预览（缓存待确认安装） */
async function previewImportSource(source: string): Promise<ImportSourcePreviewResult> {
  const raw = String(source ?? '').trim()
  if (!raw) return { ok: false, error: '请输入 npm 包名、GitHub 地址或 .dlient 直链' }
  const kind = detectInstallSourceKind(raw)
  let resolved: ResolvedImportSource
  try {
    resolved = await resolveImportSource(raw, kind)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  let previewBody: ImportSourcePreviewBody
  if (resolved.type === 'file') {
    const r = await parseImportFile(resolved.filePath)
    if ('error' in r) {
      await rm(dirname(resolved.filePath), { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, error: r.error }
    }
    previewBody = buildImportPreview(r.parsed)
  } else {
    previewBody = buildImportPreview(resolved.parsed)
  }
  const token = `si-${++pendingSourceSeq}-${Date.now()}`
  pendingSourceImports.set(token, { kind, source: raw, resolved })
  const timer = setTimeout(() => dropSourceImport(token), PENDING_SOURCE_TTL_MS)
  timer.unref()
  return { ok: true, token, kind, source: raw, preview: previewBody }
}

/** install：按预览 token 安装（复用 installPackageFile / installParsedImport）；成功才清理临时文件，失败保留以便重试 */
async function installImportSource(token: string): Promise<ImportResult> {
  const ent = pendingSourceImports.get(String(token ?? ''))
  if (!ent) return { ok: false, error: '导入预览已过期，请重新导入' }
  const result =
    ent.resolved.type === 'file'
      ? await installPackageFile(ent.resolved.filePath, new Set<string>())
      : await installParsedImport(ent.resolved.parsed, new Set<string>())
  if (result.ok) dropSourceImport(String(token))
  return result
}

/** discard：取消导入 / 关闭确认框时清理临时文件 */
async function discardImportSource(token: string): Promise<void> {
  dropSourceImport(String(token ?? ''))
}

// ---- 操作台「NPM 市场」：按关键词 dlient-open-plugin 搜索 npm，富化 dlient 元数据 ----

/** 市场检索关键词：仅插件包允许使用（插件市场检索约定） */
const NPM_MARKET_KEYWORD = 'dlient-open-plugin'
/** 单次搜索页大小 */
const NPM_MARKET_PAGE_SIZE = 30
/** date 排序需一次拉全再本地按发布时间排序（npm search 无按时间排序参数） */
const NPM_MARKET_MAX_FETCH = 250

interface NpmMarketItem {
  /** npm 包名（registry name） */
  name: string
  /** dlient 显示名（多语言对象/字符串，原样返回；由渲染层按当前语言解析） */
  title?: unknown
  /** dlient.id（无合法 id 的包不进入市场列表） */
  id: string
  version: string
  /** app=应用（可打开）；plugin=插件（不可打开） */
  type: 'app' | 'plugin'
  /** dlient 描述（多语言对象/字符串，原样返回；由渲染层按当前语言解析） */
  description?: unknown
  /** 最近发布时间（ISO；search 结果 date） */
  date: string
}

interface MarketMeta {
  id: string
  title?: unknown
  type: 'app' | 'plugin'
  version: string
  description?: unknown
}

/** 包元数据缓存（registry <name>/latest 的 dlient 段；TTL 10min，避免分页重复拉取） */
const marketMetaCache = new Map<string, { at: number; meta: MarketMeta }>()
const MARKET_META_TTL_MS = 10 * 60 * 1000

/** 拉取单个包元数据（含 dlient manifest；无合法 dlient.id 返回 null = 非有效插件） */
async function fetchMarketMeta(name: string): Promise<MarketMeta | null> {
  const cached = marketMetaCache.get(name)
  if (cached && Date.now() - cached.at < MARKET_META_TTL_MS) return cached.meta
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      headers: { 'User-Agent': 'dlient-open' },
      signal: fetchTimeoutSignal(15000),
    })
    if (!res.ok) return null
    const pkg = (await res.json()) as { version?: unknown; dlient?: Record<string, unknown> }
    const d = pkg.dlient
    if (!d || typeof d !== 'object') return null
    const id = typeof d.id === 'string' && /^[a-z0-9-]+$/.test(d.id) ? d.id : ''
    if (!id) return null
    const rawType = typeof d.type === 'string' ? d.type : 'app'
    const meta: MarketMeta = {
      id,
      // 名称/描述保留原始多语言结构，由渲染层按当前语言解析（避免主进程语言缓存与缓存失效导致语言不一致）
      title: d.name,
      type: rawType === 'app' ? 'app' : 'plugin',
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      description: d.description,
    }
    marketMetaCache.set(name, { at: Date.now(), meta })
    return meta
  } catch {
    return null
  }
}

/** npm 搜索命中（未富化：包名 / 版本 / 发布时间） */
interface MarketHit {
  name: string
  version?: string
  date?: string
}

/** 受限并发映射（避免一次性打爆 registry；供批量富化使用） */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        results[i] = await fn(items[i])
      }
    }),
  )
  return results
}

/** 调用 npm registry 搜索 API（返回原始命中，未富化） */
async function fetchMarketHits(
  queryText: string,
  from: number,
  size: number,
  weights: Record<string, number>,
): Promise<{ total: number; hits: MarketHit[] } | null> {
  const params = new URLSearchParams({ text: queryText, from: String(from), size: String(size) })
  for (const [k, v] of Object.entries(weights)) params.set(k, String(v))
  const res = await fetch(`https://registry.npmjs.org/-/v1/search?${params}`, {
    headers: { 'User-Agent': 'dlient-open' },
    signal: fetchTimeoutSignal(30000),
  }).catch(() => null)
  if (!res || !res.ok) return null
  const json = (await res.json()) as {
    total?: unknown
    objects?: Array<{ package?: { name?: unknown; version?: unknown; date?: unknown } }>
  }
  const hits: MarketHit[] = []
  for (const o of Array.isArray(json.objects) ? json.objects : []) {
    const p = o.package
    const name = typeof p?.name === 'string' ? p.name : ''
    if (!name) continue
    hits.push({
      name,
      version: typeof p?.version === 'string' ? p.version : undefined,
      date: typeof p?.date === 'string' ? p.date : undefined,
    })
  }
  return { total: Number(json.total ?? 0), hits }
}

/** 富化一批命中（并发受限；无 dlient manifest 的包被过滤） */
async function enrichMarketHits(hits: MarketHit[]): Promise<NpmMarketItem[]> {
  const metas = await mapWithLimit(hits, 8, async (h) => {
    const meta = await fetchMarketMeta(h.name)
    if (!meta) return null
    return {
      name: h.name,
      title: meta.title,
      id: meta.id,
      version: meta.version,
      type: meta.type,
      description: meta.description,
      date: h.date ?? '',
    } as NpmMarketItem
  })
  return metas.filter((x): x is NpmMarketItem => x != null)
}

/** date 排序缓存：一次拉 min(total,250) 按发布时间降序，分页从缓存切（避免每次翻页重复拉全量） */
const marketDateCache = new Map<string, { at: number; total: number; hits: MarketHit[] }>()
const MARKET_DATE_TTL_MS = 5 * 60 * 1000

interface NpmMarketQuery {
  /** 包名关键词（叠加在关键词 dlient-open-plugin 之上） */
  q?: string
  sort?: 'downloads' | 'date'
  /** 类型筛选：all / app（应用）/ plugin（插件）——作为检索关键词加入 */
  kind?: 'all' | 'app' | 'plugin'
  /** 分类标签 key（如 ai / dev-tools）——作为检索关键词加入 */
  tag?: string
  from?: number
  size?: number
}

/** 搜索 npm 上的 dlient 插件包：keyword + 类型 + 分类标签 + 包名关键词 + 排序；每页 NpmMarketItem[]（已富化/过滤无效包） */
async function searchNpmMarket(opts: NpmMarketQuery): Promise<
  { ok: true; total: number; items: NpmMarketItem[]; hasMore: boolean } | { ok: false; error: string }
> {
  const q = String(opts?.q ?? '').trim()
  const sort = opts?.sort === 'date' ? 'date' : 'downloads'
  const kind = opts?.kind === 'app' ? 'app' : opts?.kind === 'plugin' ? 'plugin' : 'all'
  const tag = String(opts?.tag ?? '').trim()
  const from = Math.max(0, Math.floor(Number(opts?.from) || 0))
  const size = Math.min(250, Math.max(1, Math.floor(Number(opts?.size) || NPM_MARKET_PAGE_SIZE)))
  // 检索规则：keywords:dlient-open-plugin（必填） + keywords:app/plugin（按类型筛选） + keywords:<分类标签 key> + 包名关键词（自由文本）；
  // 明文（未编码）：fetchMarketHits 内部经 URLSearchParams 统一编码，避免双重编码
  const text = [`keywords:${NPM_MARKET_KEYWORD}`]
  if (kind === 'app') text.push('keywords:app')
  else if (kind === 'plugin') text.push('keywords:plugin')
  if (tag) text.push(`keywords:${tag}`)
  if (q) text.push(q)
  const queryText = text.join(' ')
  try {
    if (sort === 'date') {
      // npm search API 无按时间排序参数：一次拉 min(total,250) 本地按 date 降序，翻页从缓存切
      const key = `k:${kind}:${tag}:q:${q}`
      let cached = marketDateCache.get(key)
      if (!cached || Date.now() - cached.at > MARKET_DATE_TTL_MS) {
        const all = await fetchMarketHits(queryText, 0, NPM_MARKET_MAX_FETCH, {})
        if (!all) return { ok: false, error: 'npm 市场搜索失败（网络或 registry 不可用）' }
        all.hits.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        cached = { at: Date.now(), total: all.total, hits: all.hits }
        marketDateCache.set(key, cached)
      }
      const pageHits = cached.hits.slice(from, from + size)
      const items = await enrichMarketHits(pageHits)
      return { ok: true, total: cached.total, items, hasMore: from + size < cached.hits.length }
    }
    // 按下载量：npm search 以 popularity 权重排序（≈下载量），服务端分页
    const page = await fetchMarketHits(queryText, from, size, { popularity: 1, quality: 0, maintenance: 0 })
    if (!page) return { ok: false, error: 'npm 市场搜索失败（网络或 registry 不可用）' }
    const items = await enrichMarketHits(page.hits)
    return { ok: true, total: page.total, items, hasMore: from + size < page.total }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
