/**
 * installed-registry.ts - 已安装插件统一注册表。
 *
 * 语义：已安装插件信息以 JSON 文件为准（userData/plugin-data/plugin-market/installed.json，
 * 由插件市场维护：安装 / 卸载 / 导入 / 创建都会更新它）。主进程启动时：
 *   1. 读注册表 → 校验每条目的插件目录（package.json）是否存在 → 得到真实的已安装列表；
 *   2. 核心插件（auth / layout / setting / market）齐全且目录存在 → 视为已安装，
 *      否则安装缺失项（生产从服务器同步系统插件，开发模式源码仓库内置）。
 *
 * 与 dev-plugins.ts 的关系：外部 dev 插件同样登记在此（source === 'dev'），
 * devPluginManager 的持久化改走本模块，不再使用独立 dev-plugins.json。
 */

import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PluginSource, PluginType } from '@dlient-open/core'
import { decryptForPluginSync, decryptHost, encryptForPluginSync, encryptHost } from './crypt'
import { atomicWriteFile, withFileLock } from './file-queue'

/** 核心插件（开源版）：layout / setting / nodejs 已并入宿主，无独立安装的核心插件 → 恒空 */
export const CORE_PLUGIN_IDS = [] as const

/** 已安装插件注册表条目（installed.json 数组元素） */
export interface InstalledPluginEntry {
  id: string
  name: string
  version: string
  type: PluginType
  source: PluginSource
  system?: boolean
  icon?: string
  /** dev 插件 dist 子目录相对路径（缺省 'dist'；外部 dev 插件可为任意构建输出目录） */
  dist?: string
  /** 插件根目录绝对路径 */
  path: string
  addedAt: number
  /**
   * 进程归属评估计数（docs/specs/pool.md 阶段 2）：按版本记录启动/崩溃次数。
   * 决定市场/本地插件进共享池还是 solo 池（观察期/隔离版本 → solo）。
   */
  runtime?: {
    perVersion: Record<string, { launchCount: number; crashCount: number; isolated: boolean }>
  }
}

/** 注册表文件：插件市场数据目录下的 installed.json（主进程与 market 插件共同访问） */
export function installedRegistryPath(): string {
  return join(app.getPath('userData'), 'plugin-data', 'plugin-market', 'installed.json')
}

/**
 * 注册表加密所用插件密钥：与 market 插件侧 app.crypt host-api 同一派生密钥
 * （K = HKDF(master_key, 'plugin-market')），两侧可互解；GCM 认证防手动篡改。
 */
const REGISTRY_PLUGIN_ID = 'plugin-market'

/** 校验并过滤有效条目 */
function filterValid(list: unknown): InstalledPluginEntry[] {
  if (!Array.isArray(list)) return []
  return list.filter(
    (e): e is InstalledPluginEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as InstalledPluginEntry).id === 'string' &&
      typeof (e as InstalledPluginEntry).path === 'string' &&
      typeof (e as InstalledPluginEntry).name === 'string',
  )
}

/**
 * 读取注册表（installed.json 为密文）。
 * - 密文解密成功 → 解析数组；
 * - 解密失败（含手动篡改 / 旧明文 / key 未就绪）→ 尝试明文 JSON 解析：
 *   旧明文命中 → 迁移为密文后返回；否则视为损坏 → 空数组。
 *
 * 并发说明：本函数为同步读（供 bootstrap 等同步上下文使用）。写方统一走 per-path 串行队列 +
 * 原子写（writeInstalledEntries），同步读要么读到旧文件、要么读到新文件，不会读到半写状态。
 */
export function readInstalledEntries(): InstalledPluginEntry[] {
  let raw: string
  try {
    raw = readFileSync(installedRegistryPath(), 'utf-8')
  } catch {
    return []
  }
  const trimmed = raw.trim()
  // 1) 密文解密（当前格式）
  if (trimmed) {
    try {
      return filterValid(JSON.parse(decryptForPluginSync(REGISTRY_PLUGIN_ID, trimmed)))
    } catch {
      /* 解密失败 → 旧明文 / 篡改 / key 未就绪，走下方明文兜底 */
    }
  }
  // 2) 明文兜底（历史版本明文注册表）：解析成功后迁移为密文
  try {
    const valid = filterValid(JSON.parse(raw))
    if (valid.length === 0) return valid
    void writeInstalledEntries(valid).catch(() => undefined) // 一次性迁移：明文 → 密文（失败忽略，下次写入自动迁移）
    return valid
  } catch {
    return [] // 损坏 / 被手动篡改 → 视为空注册表
  }
}

/** 实际写盘（调用方需已持锁）：密文整体覆盖，原子写（tmp + rename），保证目录存在 */
async function writeRegistryFile(entries: InstalledPluginEntry[]): Promise<void> {
  const file = installedRegistryPath()
  mkdirSync(dirname(file), { recursive: true })
  const cipher = encryptForPluginSync(REGISTRY_PLUGIN_ID, JSON.stringify(entries))
  await atomicWriteFile(file, cipher, 'utf-8')
}

/** 写入注册表（密文，整体覆盖）：经 per-path 串行队列（与 host-api fs.write 同路径互斥） */
export async function writeInstalledEntries(entries: InstalledPluginEntry[]): Promise<void> {
  await withFileLock(installedRegistryPath(), () => writeRegistryFile(entries))
}

/** 按 id 合并写入（已存在则更新，不存在则追加）：读-改-写在同一路径锁内完成 */
export async function upsertInstalledEntry(entry: InstalledPluginEntry): Promise<void> {
  await withFileLock(installedRegistryPath(), () => {
    const entries = readInstalledEntries()
    const idx = entries.findIndex((e) => e.id === entry.id)
    if (idx >= 0) entries[idx] = entry
    else entries.push(entry)
    return writeRegistryFile(entries)
  })
}

/** 按 id 移除（幂等）：读-改-写在同一路径锁内完成 */
export async function removeInstalledEntry(id: string): Promise<void> {
  await withFileLock(installedRegistryPath(), () => {
    const entries = readInstalledEntries()
    const next = entries.filter((e) => e.id !== id)
    if (next.length !== entries.length) return writeRegistryFile(next)
    return undefined
  })
}

/** 目录是否包含有效插件（package.json 存在） */
export function pluginDirExists(entry: Pick<InstalledPluginEntry, 'path'>): boolean {
  return existsSync(join(entry.path, 'package.json'))
}

// ---- 阶段 2：进程归属评估计数（docs/specs/pool.md §4）----

/** 观察期启动次数（< OBSERVE_LAUNCHES 走 solo 池观察，达到且崩溃 ≤ 阈值才进共享池） */
export const OBSERVE_LAUNCHES = 10
/** 观察期内允许的崩溃次数（> 阈值 → isolated，永久 solo） */
export const ISOLATE_CRASHES = 3

/** 某版本计数记录（缺省返回初始 0 记录） */
export interface VersionRuntime {
  launchCount: number
  crashCount: number
  isolated: boolean
}

/** 取指定插件指定版本的评估记录（无记录 → 初始状态，视为观察期） */
export function getVersionRuntime(pluginId: string, version: string): VersionRuntime {
  const entry = readInstalledEntries().find((e) => e.id === pluginId)
  const rec = entry?.runtime?.perVersion?.[version]
  return { launchCount: rec?.launchCount ?? 0, crashCount: rec?.crashCount ?? 0, isolated: rec?.isolated ?? false }
}

/** 进程归属决策（阶段 2 §4.1）：dev / workerMode:solo / 观察期 / 隔离版本 → solo；稳定版本 → 共享池。
 *  system 插件由调用方先按 poolKeyFor 走 'system' 池，不进本评估。 */
export function shouldIsolate(pluginId: string, version: string, source?: string, workerMode?: 'shared' | 'solo'): boolean {
  if (source === 'dev') return true
  if (workerMode === 'solo') return true
  const rt = getVersionRuntime(pluginId, version)
  if (rt.isolated) return true
  if (rt.launchCount < OBSERVE_LAUNCHES) return true // 观察期 → solo
  return false // poolable → 共享池
}

/** 记录一次有效启动（startPlugin 成功进入 running 后调用；幂等，写盘失败忽略） */
export async function recordPluginLaunch(pluginId: string, version: string): Promise<void> {
  await updateVersionRuntime(pluginId, version, (rt) => ({ ...rt, launchCount: rt.launchCount + 1 }))
}

/** 记录一次崩溃（进程/池异常退出或 load-failed；主动 stop 不计）。超过阈值标记 isolated（该版本永久 solo） */
export async function recordPluginCrash(pluginId: string, version: string): Promise<void> {
  await updateVersionRuntime(pluginId, version, (rt) => {
    const crashCount = rt.crashCount + 1
    return { launchCount: rt.launchCount, crashCount, isolated: crashCount > ISOLATE_CRASHES }
  })
}

/** 读-改-写版本计数（同一路径锁内完成；插件未登记时无操作） */
async function updateVersionRuntime(
  pluginId: string,
  version: string,
  mutate: (rt: VersionRuntime) => VersionRuntime,
): Promise<void> {
  await withFileLock(installedRegistryPath(), () => {
    const entries = readInstalledEntries()
    const idx = entries.findIndex((e) => e.id === pluginId)
    if (idx < 0) return undefined
    const entry = entries[idx]
    const perVersion = { ...(entry.runtime?.perVersion ?? {}) }
    const prev = perVersion[version] ?? { launchCount: 0, crashCount: 0, isolated: false }
    perVersion[version] = mutate(prev)
    entries[idx] = { ...entry, runtime: { perVersion } }
    return writeRegistryFile(entries)
  })
}

// ---- 快照哈希（manifest 防篡改；docs/specs/store-event.md「org 获取与判定」）----
// 语义：安装/导入后首次见到插件目录时，把 package.json 的 SHA-256 经 encryptHost（AES-256-GCM，
// 根密钥受 safeStorage/OS 密钥链保护）加密后存主进程私有文件（pkg-hash.json），之后不再更新；
// 加载时解密比对当前磁盘哈希 —— 篡改 package.json 会哈希失配；改密文无密钥无法伪造合法密文。
// 存储按插件目录绝对路径为键：卸载重装同路径可重新锚定；记录整体被删/替换不在密文防护内。

/** 快照哈希存储文件：与 master.key 同目录（主进程私有，encryptHost 加密） */
function pkgHashStorePath(): string {
  return join(app.getPath('userData'), 'plugin-data', '_host', 'pkg-hash.json')
}

/** 计算插件 package.json 的 SHA-256（剥离 BOM；读取失败返回 null） */
export function computePkgHash(dir: string): string | null {
  try {
    const raw = String(readFileSync(join(dir, 'package.json'), 'utf-8')).replace(/^\uFEFF/, '')
    return createHash('sha256').update(raw).digest('hex')
  } catch {
    return null
  }
}

/** 读取快照哈希表（path → cipher）；文件缺失 / 解密失败视为空表 */
async function loadPkgHashes(): Promise<Map<string, string>> {
  try {
    const raw = await readFile(pkgHashStorePath(), 'utf-8')
    const plain = await decryptHost(raw.trim())
    const obj = JSON.parse(plain) as Record<string, string>
    const map = new Map<string, string>()
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') map.set(k, v)
    }
    return map
  } catch {
    return new Map()
  }
}

/** 写快照哈希表（加密整体覆盖；目录不存在时创建） */
async function savePkgHashes(map: Map<string, string>): Promise<void> {
  const file = pkgHashStorePath()
  mkdirSync(dirname(file), { recursive: true })
  const cipher = await encryptHost(JSON.stringify(Object.fromEntries(map)))
  await atomicWriteFile(file, cipher, 'utf-8')
}

/**
 * 同步快照哈希集合（宿主 reportInstalled 时调用；幂等）。
 * - 集合内已记录 → 保持原值（首装后不再更新 —— 篡改检测的关键）；
 * - 集合内未记录 → 补录当前哈希（首装信任锚）；
 * - 集合外（已卸载/导入未生效）→ 删除旧记录（同路径重装可重新锚定）。
 */
export async function syncPkgHashes(paths: string[]): Promise<void> {
  const wanted = new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0))
  const map = await loadPkgHashes()
  let dirty = false
  for (const key of Array.from(map.keys())) {
    if (!wanted.has(key)) {
      map.delete(key)
      dirty = true
    }
  }
  for (const p of wanted) {
    if (map.has(p)) continue
    const hash = computePkgHash(p)
    if (!hash) continue
    map.set(p, await encryptHost(hash))
    dirty = true
  }
  if (dirty) await savePkgHashes(map)
}

/**
 * 校验插件快照哈希（resolveOrg 前置）：
 * - 'ok'：解密成功且与当前磁盘哈希一致；
 * - 'tampered'：解密失败（密文损坏/密钥不匹配）或哈希不一致 → 判篡改；
 * - 'unrecorded'：无快照（首装后尚未 sync）→ 补录当前哈希，本次按未验证处理（org 判定保守置空）。
 */
export async function verifyPkgHash(dir: string): Promise<'ok' | 'tampered' | 'unrecorded'> {
  const map = await loadPkgHashes()
  const cipher = map.get(dir)
  if (!cipher) {
    const hash = computePkgHash(dir)
    if (hash) {
      map.set(dir, await encryptHost(hash))
      await savePkgHashes(map)
    }
    return 'unrecorded'
  }
  let snapshot: string
  try {
    snapshot = await decryptHost(cipher)
  } catch {
    return 'tampered'
  }
  const current = computePkgHash(dir)
  if (current === null || current !== snapshot) return 'tampered'
  return 'ok'
}
