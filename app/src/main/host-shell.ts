/**
 * host-shell.ts - 内置宿主壳（layout / setting）首方 IPC 通道。
 *
 * layout / setting 并入宿主后不再是插件，无法经 worker RPC 调用宿主能力；
 * 这里提供首方（first-party）IPC：窗口控制 / 原生菜单 / 内容区活动归属 /
 * 插件清单 / 就绪检测 / nodejs 运行时 / .dlient 导入。
 * 仅注册白名单方法，不做插件级授权（宿主壳为可信首方 UI）。
 */

import { BrowserWindow, app, dialog, globalShortcut, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'
import { execFile } from 'node:child_process'
import { getWindowController, popupNativeMenu } from './lib/app'
import { webviewSetActivePlugin } from './lib/webview'
import { checkBundled, checkLocal, getNodejsProgress, installNodejs, resolveRuntime, withNpmRegistry } from './nodejs'
import { upsertInstalledEntry, removeInstalledEntry, type InstalledPluginEntry } from './installed-registry'
import { broadcastAppSetting, useSystemNativeTheme } from './lib/theme'
import { atomicWriteFile, withFileLock } from './file-queue'

const inflateRawAsync = promisify(inflateRaw)

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
  /** 插件根目录（~/.dlient/plugins） */
  pluginsRoot: () => string
  /** 快捷键动作分发（'show-main-window' 等；与 runtime 装配同一入口） */
  runShortcutAction: (action: string) => void
}

let shellDeps: HostShellDeps | null = null

// ---- 设置持久化（内置 setting；~/.dlient/settings.json）----

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

  // ---- .dlient 导入（layout「导入插件」入口）----
  handle('import-plugin', () => importPlugin())

  // 卸载（layout 右侧菜单「卸载」；移除目录 + 注册表 + 缓存 + 广播）
  handle('uninstall-plugin', async (pluginId: unknown) => {
    const id = String(pluginId ?? '')
    if (!id || !/^[a-z0-9-]+$/.test(id)) return { ok: false, error: `invalid plugin id: ${id}` }
    const record = requireDeps().listPlugins().find((p) => p.id === id)
    if (!record) return { ok: false, error: `plugin not installed: ${id}` }
    await rm(record.path, { recursive: true, force: true }).catch(() => undefined)
    await removeInstalledEntry(id).catch(() => undefined)
    requireDeps().broadcastChange(id, 'uninstalled')
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

/** 读插件 manifest 的依赖与 nodeVersion（path 目录下 package.json 的 dlient 段） */
function readManifestRuntime(dir: string): { dependencies: string[]; nodeVersion?: string } | null {
  try {
    const pkg = JSON.parse(String(readFileSync(join(dir, 'package.json'), 'utf-8')).replace(/^\uFEFF/, '')) as {
      dlient?: { dependencies?: Record<string, unknown> | unknown[]; nodeVersion?: unknown }
    }
    const d = pkg.dlient
    if (!d) return null
    const deps = d.dependencies
    const depIds = Array.isArray(deps)
      ? deps.map((x) => String(x))
      : deps && typeof deps === 'object'
        ? Object.keys(deps as Record<string, unknown>)
        : []
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
  manifest?: { dependencies?: unknown; nodeVersion?: unknown },
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
    const deps = isRoot && manifest ? depIdsOf(manifest.dependencies) : entry ? entry.dependencies : []
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

/** 异步执行 npm install（原生模块；等待退出，超时 kill） */
async function npmInstall(pluginDir: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  const rt = await resolveRuntime()
  if (rt.source === 'none' || !rt.node) return { ok: false, error: 'node runtime not available for native modules' }
  const npmArgs = await withNpmRegistry(['install', '--no-audit', '--no-fund', ...args])
  const cmd = rt.npmCli && rt.source === 'bundled' ? rt.node : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const finalArgs = rt.npmCli && rt.source === 'bundled' ? [rt.npmCli, ...npmArgs] : npmArgs
  return await new Promise((resolve) => {
    const child = execFile(cmd, finalArgs, { cwd: pluginDir, timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err) => {
      if (!err) return resolve({ ok: true })
      const message = err instanceof Error ? err.message : String(err)
      resolve({ ok: false, error: message })
    })
    child.on('error', (e) => {
      resolve({ ok: false, error: e.message })
    })
  })
}

/** .dlient 导入：选文件 → 解包 → manifest 校验 → 落盘 → 原生模块 → 注册表 → 上报 → 广播 */
async function importPlugin(): Promise<{
  ok: boolean
  id?: string
  name?: string
  version?: string
  exists?: boolean
  error?: string
} | null> {
  const deps = requireDeps()
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const picked = await dialog.showOpenDialog(win, {
    title: '导入 .dlient 插件',
    properties: ['openFile'],
    filters: [{ name: 'dlient package', extensions: ['dlient'] }],
  }).catch(() => null)
  const filePath = picked?.filePaths?.[0]
  if (!filePath) return null // 取消

  try {
    const buf = await readFile(filePath)
    const entries = await extractZip(buf)
    const root = commonRoot(entries)
    const pkgEntry = entries.find((e) => e.name === `${root}package.json`) ?? entries.find((e) => e.name === 'package.json')
    if (!pkgEntry) return { ok: false, error: '.dlient 包中未找到 package.json' }
    const pkg = JSON.parse(pkgEntry.data.toString('utf-8')) as Record<string, unknown> & { version?: string; dlient?: Record<string, unknown> }
    const d = pkg.dlient
    if (!d || typeof d !== 'object') return { ok: false, error: '未找到有效的插件 manifest（package.json 的 dlient.id）' }
    const id = String(d.id ?? '')
    if (!id || !/^[a-z0-9-]+$/.test(id)) return { ok: false, error: `插件 ID 不合法：${id || '(缺失)'}` }
    if (d.system === true) return { ok: false, error: '系统插件不允许通过导入安装' }

    const version = String(d.version ?? pkg.version ?? '0.0.0')
    const name = typeof d.name === 'string' ? d.name : (d.name as { default?: string } | undefined)?.default ?? id
    const targetDir = join(deps.pluginsRoot(), id)

    // 覆盖安装：先清旧目录（防产物残留）
    await rm(targetDir, { recursive: true, force: true })
    await writeEntriesToDir(targetDir, entries)

    // 修正 manifest（source=local / system=false；不保留包内可能存在的签名相关字段语义）
    const patched = { ...pkg, dlient: { ...(d as Record<string, unknown>), source: 'local', system: false } }
    await writeFile(join(targetDir, 'package.json'), JSON.stringify(patched, null, 2), 'utf-8')

    // 原生模块：声明 nativeModules 时先确保 node 运行时，再 npm install
    const nativeModules = (d as Record<string, unknown>).nativeModules as { dependencies?: Record<string, string> } | undefined
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
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
