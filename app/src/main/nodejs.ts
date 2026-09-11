/**
 * nodejs.ts - Node.js 运行时管理（开源版内置，替代原 nodejs 插件 worker）。
 *
 * 按需惰性安装：layout 打开声明需要 nodejs（dlient.dependencies 含 nodejs / dlient.nodeVersion）
 * 或包含原生模块的插件时，先 checkLocal / checkBundled 判定，缺失则 install 下载到
 * <userData>/plugin-data/nodejs（与旧插件隔离目录一致，兼容既有插件对路径的假设）。
 * 运行于宿主主进程（Node 环境），直接使用 node:child_process / node:fs / fetch。
 */

import { execFile } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { app } from 'electron'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'

/** 异步解压：不阻塞主进程事件循环 */
const inflateRawAsync = promisify(inflateRaw)

// ---- 进度状态（layout 安装页轮询）----

export interface NodejsProgress {
  status: 'idle' | 'downloading' | 'extracting' | 'done' | 'error'
  phase: string
  received: number
  total: number
  progress: number
  version?: string
  path?: string
  message?: string
}

let progress: NodejsProgress = { status: 'idle', phase: '', received: 0, total: 0, progress: 0 }

function computeRatio(p: NodejsProgress): number {
  if (p.status === 'extracting') return 1
  if (!p.total) return 0
  return Math.min(1, p.received / p.total)
}

function setProgress(p: Partial<NodejsProgress>): void {
  const next = { ...progress, ...p }
  next.progress = p.status === 'done' ? 1 : p.status === 'error' ? 0 : computeRatio(next)
  progress = next
}

export function getNodejsProgress(): NodejsProgress {
  return progress
}

/** 内置 nodejs 安装目录（与旧 nodejs 插件隔离目录一致） */
export function nodejsDir(): string {
  return join(app.getPath('userData'), 'plugin-data', 'nodejs')
}

function bundledExe(): string {
  return join(nodejsDir(), process.platform === 'win32' ? 'node.exe' : 'node')
}

// ---- 版本 / 探测 ----

/** 异步执行命令并捕获 stdout（execFile 阻塞等待退出，探测类命令用） */
function runVersion(cmd: string, args: string[]): Promise<{ ok: boolean; out?: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve({ ok: false })
      const out = String(stdout ?? '').trim()
      resolve(out ? { ok: true, out } : { ok: false })
    })
  })
}

/** 解析 node 版本号（v22.11.0 → [22,11,0]；补零至 [major,minor,patch]）；无法解析返回 null */
function parseNodeVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.?(\d+)?\.?(\d+)?/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

/** 校验 node 实际版本是否满足最低要求（"22" / ">=22" / "22.11"）；未声明要求恒满足 */
export function satisfiesNode(actual: string | undefined, req: string | undefined): boolean {
  if (!req) return true
  if (!actual) return false
  const a = parseNodeVersion(actual)
  const r = parseNodeVersion(req.trim().replace(/^>=?/, ''))
  if (!a || !r) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== r[i]) return a[i] > r[i]
  }
  return true
}

/** 本地（PATH / 常见安装路径）node 检测 */
export async function checkLocal(opts?: { version?: string }): Promise<{
  hasNode: boolean
  version?: string
  path?: string
  satisfies?: boolean
}> {
  const pathRes = await runVersion(process.platform === 'win32' ? 'node.exe' : 'node', ['--version'])
  if (pathRes.ok) {
    return { hasNode: true, version: pathRes.out, path: 'node', satisfies: satisfiesNode(pathRes.out, opts?.version) }
  }
  for (const p of nodePathCandidates()) {
    if (p && existsSync(p)) {
      const res = await runVersion(p, ['--version'])
      if (res.ok) return { hasNode: true, version: res.out, path: p, satisfies: satisfiesNode(res.out, opts?.version) }
    }
  }
  return { hasNode: false }
}

/** 常见 node 安装路径（PATH 未命中时的兜底候选；checkLocal 与命令别名解析共用） */
export function nodePathCandidates(): string[] {
  return process.platform === 'win32'
    ? [
        'C:\\Program Files\\nodejs\\node.exe',
        join(process.env.APPDATA ?? '', 'nvm', 'node.exe'),
        join(process.env.PROGRAMFILES ?? '', 'nodejs', 'node.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
      : ['/usr/bin/node', '/usr/local/bin/node']
}

/**
 * PATH 中按名字查找可执行文件（纯 fs 检查，不启动进程）。
 * Windows 按 PATHEXT 顺序补扩展名（`.EXE` 先于 `.CMD`，故优先命中真实可执行文件）；
 * 路径分隔符取 `delimiter`，环境变量名大小写不敏感（Windows 上 PATH 可能是 `Path`）。
 */
export function whichSync(names: string[]): string | null {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path')
  const raw = pathKey ? process.env[pathKey] : undefined
  const dirs = String(raw ?? '')
    .split(delimiter)
    .filter(Boolean)
  const exts = process.platform === 'win32' ? String(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of exts) {
        const p = join(dir, name + ext)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

/** 内置 node 可执行文件定位（不校验存在性） */
export function bundledNodeExe(): string {
  return bundledExe()
}

/** node 可执行文件绝对路径定位：内置优先 → PATH → 常见安装路径（纯 fs 检查，不启动进程） */
export function locateNodeExe(): { cmd: string; source: 'bundled' | 'path' } | null {
  const bundled = bundledExe()
  if (existsSync(bundled)) return { cmd: bundled, source: 'bundled' }
  const hit = whichSync(['node'])
  if (hit) return { cmd: hit, source: 'path' }
  for (const p of nodePathCandidates()) {
    if (p && existsSync(p)) return { cmd: p, source: 'path' }
  }
  return null
}

/** node 发行包自带的 npm / npx cli 脚本绝对路径（Windows 与 POSIX 布局不同）；不存在返回 null */
export function npmCliPathFor(nodeExe: string, cli: 'npm-cli.js' | 'npx-cli.js'): string | null {
  const dir = dirname(nodeExe)
  const candidates = [
    join(dir, 'node_modules', 'npm', 'bin', cli), // Windows 官方包 / 宿主内置运行时
    join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', cli), // POSIX（/usr/local/bin → /usr/local/lib/...）
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

/** 内置 node 检测（<userData>/plugin-data/nodejs） */
export async function checkBundled(opts?: { version?: string }): Promise<{
  ready: boolean
  version?: string
  path?: string
  satisfies?: boolean
}> {
  const exe = bundledExe()
  if (!existsSync(exe)) return { ready: false }
  const res = await runVersion(exe, ['--version'])
  if (!res.ok) return { ready: false }
  return { ready: true, version: res.out, path: exe, satisfies: satisfiesNode(res.out, opts?.version) }
}

/**
 * 解析可用 node 运行环境（内置优先，其次 PATH；声明版本要求时按是否满足过滤）。
 * source: 'bundled' | 'path' | 'none'
 *
 * `node` 一律返回**绝对可执行文件路径**（PATH 命中时也经 whichSync 绝对化）——调用方据此推导
 * npm 全局目录 / PATH 前置等；需要跨「换机器 / 换版本」稳定的命令标识时用命令别名（CMD_NODE 等）。
 */
export async function resolveRuntime(opts?: { version?: string }): Promise<{
  node?: string
  npm?: string
  npmCli?: string
  source: 'bundled' | 'path' | 'none'
  version?: string
}> {
  const req = (opts ?? {}).version
  const bundled = await checkBundled({ version: req })
  if (bundled.ready && bundled.path && bundled.satisfies) {
    return {
      node: bundled.path,
      npm: bundled.path,
      npmCli: join(dirname(bundled.path), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      source: 'bundled',
      version: bundled.version,
    }
  }
  const local = await checkLocal({ version: req })
  if (local.hasNode && local.satisfies) {
    // checkLocal 的 PATH 命中只回 'node'（名字而非路径）→ 绝对化，供调用方推导目录
    const node = local.path && local.path !== 'node' && local.path !== 'node.exe' ? local.path : (locateNodeExe()?.cmd ?? 'node')
    const npmCli = npmCliPathFor(node, 'npm-cli.js')
    return { node, npm: 'npm', ...(npmCli ? { npmCli } : {}), source: 'path', version: local.version }
  }
  return { source: 'none' }
}

// ---- 地区镜像（中国地区用 npmmirror，其他地区官方源）----

const CHINA_LOCALE_PREFIXES = ['zh']
let localeCache: string | undefined

/** 经 app.getLocale 判定是否为中国地区（locale 以 zh 开头）；失败回退官方源 */
async function isChinaRegion(): Promise<boolean> {
  if (localeCache === undefined) {
    try {
      const res = app.getLocale()
      localeCache = typeof res === 'string' ? res : 'en-US'
    } catch {
      localeCache = 'en-US'
    }
  }
  return CHINA_LOCALE_PREFIXES.some((p) => localeCache!.startsWith(p))
}

async function nodeDistBase(): Promise<string> {
  return (await isChinaRegion()) ? 'https://npmmirror.com/mirrors/node' : 'https://nodejs.org/dist'
}

export async function npmRegistry(): Promise<string | undefined> {
  return (await isChinaRegion()) ? 'https://registry.npmmirror.com' : undefined
}

/** 中国地区为 npm 显式注入 --registry（保证确定性，不透传用户 npmrc）；已有 --registry 则不覆盖 */
export async function withNpmRegistry(args: string[]): Promise<string[]> {
  const reg = await npmRegistry()
  if (!reg || args.some((a) => a.startsWith('--registry'))) return args
  return [...args, `--registry=${reg}`]
}

// ---- 安装 ----

interface InstallError extends Error {
  installCode?: string
  installParams?: Record<string, unknown>
}

function installErr(code: string, message: string, params?: Record<string, unknown>): InstallError {
  const e = new Error(message) as InstallError
  e.installCode = code
  if (params) e.installParams = params
  return e
}

async function latestLtsVersion(): Promise<string> {
  const res = await fetch(`${await nodeDistBase()}/index.json`, { redirect: 'follow' })
  if (!res.ok) throw installErr('VERSION_FETCH_FAIL', `Failed to fetch Node.js version list (HTTP ${res.status})`, { status: res.status })
  const list = (await res.json()) as Array<{ version: string; lts?: string | boolean }>
  const item = list.find((x) => x.lts)
  if (!item) throw installErr('NO_LTS', 'No LTS version found in Node.js version list')
  return item.version
}

function distSuffix(): { name: string; ext: 'zip' | 'tar.gz' } {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch === 'arm' ? 'armv7l' : process.arch
  if (process.platform === 'win32') return { name: `win-${arch}`, ext: 'zip' }
  if (process.platform === 'darwin') return { name: `darwin-${arch}`, ext: 'tar.gz' }
  return { name: `linux-${arch}`, ext: 'tar.gz' }
}

async function downloadFile(url: string, target: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw installErr('DOWNLOAD_FAIL', `Download failed (HTTP ${res.status} ${res.statusText})`, { status: res.status, statusText: res.statusText })
  const total = Number(res.headers.get('content-length')) || 0
  setProgress({ status: 'downloading', phase: '下载中', received: 0, total })

  const reader = res.body.getReader()
  const file = createWriteStream(target)
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    file.write(Buffer.from(value))
    setProgress({ status: 'downloading', phase: '下载中', received, total })
  }
  await new Promise<void>((resolve, reject) => {
    file.end((err?: Error | null) => (err ? reject(err) : resolve()))
  })
  setProgress({ status: 'downloading', phase: '下载中', received: total || received, total: total || received })
}

// ---- 极简 zip 解包（EOCD + 中央目录 + 本地头，支持 stored/deflate）----

interface ZipEntry {
  name: string
  method: number
  data: Buffer
}

function parseZipEntries(buffer: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw installErr('ZIP_NO_EOCD', 'Invalid zip archive (no EOCD)')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw installErr('ZIP_DIR', 'Invalid zip archive (central directory)')
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
      throw new Error(`invalid zip local header: ${name}`)
    }
    const lNameLen = buffer.readUInt16LE(localOffset + 26)
    const lExtraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    entries.push({ name, method, data: buffer.subarray(dataStart, dataStart + compSize) })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function extractZipToDir(zipPath: string, outDir: string): Promise<void> {
  const entries = parseZipEntries(await readFile(zipPath))
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue
    const raw = entry.method === 0 ? entry.data : entry.method === 8 ? await inflateRawAsync(entry.data) : null
    if (!raw) throw installErr('ZIP_METHOD', `Unsupported zip compression (${entry.method}): ${entry.name}`, { method: entry.method, name: entry.name })
    const out = join(outDir, entry.name)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, raw)
  }
}

async function flattenTopDir(dir: string): Promise<void> {
  const inners = (await readdir(dir)).filter((name) => name.startsWith('node-v'))
  if (inners.length !== 1) return
  const inner = join(dir, inners[0])
  for (const name of await readdir(inner)) {
    await rename(join(inner, name), join(dir, name))
  }
  await rm(inner, { recursive: true, force: true })
}

async function cleanDirExcept(dir: string, keep: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
    return
  }
  for (const name of await readdir(dir)) {
    const p = join(dir, name)
    if (p === keep) continue
    await rm(p, { recursive: true, force: true })
  }
}

/** 异步执行命令并等待退出（收集 stdout/stderr；超时 kill） */
async function runCommand(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 600000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = typeof (err as { code?: unknown } | null)?.code === 'number' ? (err as { code: number }).code : err ? -1 : 0
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

async function install(version?: string): Promise<{
  ok: boolean
  version?: string
  path?: string
  error?: string
  code?: string
  params?: Record<string, unknown>
}> {
  const targetDir = nodejsDir()
  let tmpFile = ''
  try {
    await mkdir(targetDir, { recursive: true })
    const ver = version && /^v?\d+\.\d+\.\d+$/.test(version)
      ? (version.startsWith('v') ? version : `v${version}`)
      : await latestLtsVersion()
    const { name, ext } = distSuffix()
    const url = `${await nodeDistBase()}/${ver}/node-${ver}-${name}.${ext}`
    tmpFile = join(targetDir, `.nodejs-${Date.now()}.${ext}`)

    setProgress({ status: 'downloading', phase: '下载中', received: 0, total: 0 })
    await downloadFile(url, tmpFile)

    setProgress({ status: 'extracting', phase: '解压中', received: 1, total: 1 })
    await cleanDirExcept(targetDir, tmpFile)
    if (ext === 'zip') {
      await extractZipToDir(tmpFile, targetDir)
    } else {
      const r = await runCommand('tar', ['-xzf', tmpFile, '-C', targetDir], { timeoutMs: 180000 })
      if (r.code !== 0) throw installErr('TAR_FAIL', `Extract failed (tar exit ${r.code})`, { code: r.code })
    }
    await flattenTopDir(targetDir)

    await rm(tmpFile, { force: true })
    tmpFile = ''
    const exe = bundledExe()
    if (!existsSync(exe)) throw installErr('NODE_EXE_MISSING', 'Installation finished but node executable not found')
    const vres = await runVersion(exe, ['--version'])
    const installedVersion = vres.ok ? vres.out ?? ver : ver
    setProgress({ status: 'done', phase: '完成', received: 1, total: 1, version: installedVersion, path: exe })
    return { ok: true, version: installedVersion, path: exe }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as InstallError | null)?.installCode
    const params = (err as InstallError | null)?.installParams
    if (tmpFile) await rm(tmpFile, { force: true })
    setProgress({ status: 'error', phase: '失败', received: 0, total: 0, message })
    return { ok: false, error: message, ...(code ? { code, params } : {}) }
  }
}

/** 安装单飞：并发调用复用同一安装，避免共享 targetDir 互相清理临时包 */
let installInFlight: Promise<{ ok: boolean; version?: string; path?: string; error?: string }> | null = null
export function installNodejs(version?: string): Promise<{ ok: boolean; version?: string; path?: string; error?: string }> {
  if (installInFlight) return installInFlight
  const ver = typeof version === 'string' ? version : undefined
  installInFlight = install(ver).finally(() => {
    installInFlight = null
  })
  return installInFlight
}
