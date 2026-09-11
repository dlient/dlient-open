/**
 * resource-grants.ts - 资源级授权表（fs / net / spawn）+ 路径 / URL / 命令白名单。
 *
 * 与 grants.ts（跨插件方法授权）区分：本模块管「资源」——文件/目录、URL、命令。
 * 授权作用域（§4.6）：
 *  - persistent：落盘 `<type>-grants.json`（可撤销，市场「权限」页可删除）；
 *  - session：纯内存、不落盘，宿主退出即失效（worker 重启 / 热重载不清空）。
 *
 * 白名单来源（§4.1）：
 *  - fs：DATA（插件数据目录，默认授予）+ fsDirs（manifest 声明）+ fs-grants / session-grants；
 *  - net：net-grants / session-grants（域名 / URL 前缀级）；
 *  - spawn：插件运行目录 + spawnCmds（manifest 声明）+ spawn-grants / session-grants。
 *
 * 校验函数均为「命中任一来源即放行」；宿主每次调用都过校验，不信任插件自报已授权。
 */

import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises'
import { basename, dirname, join, normalize, sep } from 'node:path'
import { app } from 'electron'
import { encryptHost, decryptHost } from './crypt'
import { logger } from '@dlient-open/core'

export type ResourceType = 'fs' | 'net' | 'spawn'
export type GrantScope = 'persistent' | 'session'
export type FsGrantMode = 'read' | 'write'

/** 持久授权记录（session 不落盘，仅内存）。
 *  pluginId 必须随记录落盘：重启 load() 按属主重建索引键（旧版缺 pluginId 的记录无法归属，
 *  会落入 orphans 待收养/或作废，见 load/adopt）。 */
interface ResourceGrant {
  type: ResourceType
  /** fs=绝对路径；net=URL 前缀；spawn=命令 */
  target: string
  /** 属主插件实例键（如 dev-tools、nodejs@dev） */
  pluginId: string
  /** fs 专用：read / write */
  mode?: FsGrantMode
  scope: GrantScope
  grantedAt: number
}

/** 临时一次性授权（save 场景：命中未过期即提升为会话授权，见 consumeTemp 注释） */
interface TempGrant {
  target: string
  mode?: FsGrantMode
  expiresAt: number
}

/** temp-grant 默认有效期 */
export const TEMP_GRANT_TTL_MS = 30_000

/** 持久化防抖窗口（多次 grant/revoke 合并为一次写盘；修复任务 F10） */
const GRANT_PERSIST_DEBOUNCE_MS = 200

/** manifest.fsDirs 目录声明（别名或绝对路径；read 与 write 分开） */
export interface FsDirsDeclaration {
  read?: string[]
  write?: string[]
}

/**
 * manifest.spawnCmds 规则（修复任务 F9，2026-09-02）：
 *  - string：仅命令、参数不限（旧格式；注册时宿主 warn 提示“无参数约束”）；
 *  - { cmd, argsPattern }：命令 + 参数约束，逐参数正则匹配、自动锚定 `^(?:...)$`、长度上限。
 * 解释器（python3/node/bash 等）建议一律用对象规则，避免“授权即 RCE”。
 *
 * 命令可写绝对路径、basename，或命令别名（CMD_NODE / CMD_NPM / CMD_NPX / CMD_PNPM）：
 * 别名由宿主在 spawn 时解析为真实可执行文件（lib/cmd-alias.ts），授权/记账/审计均按别名，
 * 因此换机器 / 换 node 版本不会重新弹框。
 */
export type SpawnRule = string | { cmd: string; argsPattern?: string }

/** manifest.spawnCmds 命令声明（可执行文件绝对路径或 basename 或规则） */
export interface SpawnCmdsDeclaration {
  cmds?: SpawnRule[]
}

/** isSpawnAllowed 三态结果：allow=放行；nomatch=不在白名单（走弹框）；args-denied=cmd 命中但参数违约（硬拒绝） */
export type SpawnVerdict = 'allow' | 'nomatch' | 'args-denied'

/** spawn 参数匹配保护上限：防止超长/超多参数拖垮校验与正则 */
const SPAWN_ARGS_MAX = 64
const SPAWN_ARG_MAX_LEN = 4096
const SPAWN_PATTERN_MAX_LEN = 256

/** argsPattern → 编译缓存（锚定整参数）；非法/超长返回 null（视为无约束，注册期已 warn） */
const spawnPatternCache = new Map<string, RegExp | null>()
function compileSpawnPattern(pattern: string): RegExp | null {
  const cached = spawnPatternCache.get(pattern)
  if (cached !== undefined) return cached
  let re: RegExp | null = null
  if (pattern && pattern.length <= SPAWN_PATTERN_MAX_LEN) {
    try {
      re = new RegExp(`^(?:${pattern})$`)
    } catch {
      re = null
    }
  }
  spawnPatternCache.set(pattern, re)
  return re
}

/** 目录别名 → 解析为绝对路径（app.getPath；DATA 为插件数据目录，随插件变化） */
const DIR_ALIASES: Record<string, (pluginId: string) => string | null> = {
  DOWNLOAD: () => app.getPath('downloads'),
  DOCUMENT: () => app.getPath('documents'),
  DESKTOP: () => app.getPath('desktop'),
  PICTURE: () => app.getPath('pictures'),
  RECENT: () => app.getPath('recent'),
  MUSIC: () => app.getPath('music'),
  VIDEO: () => app.getPath('videos'),
  HOME: () => app.getPath('home'),
  TEMP: () => app.getPath('temp'),
  DATA: (pluginId) => join(app.getPath('userData'), 'plugin-data', pluginId),
  /** 插件安装根目录（USER_DATA/plugins；dev-tools / market-admin 等编排类插件用） */
  PLUGINS: () => join(app.getPath('userData'), 'plugins'),
}

/** 解析目录别名（失败返回 null；DATA 需 pluginId 上下文） */
export function resolveDirAlias(alias: string, pluginId: string): string | null {
  const fn = DIR_ALIASES[String(alias).toUpperCase()]
  if (!fn) return null
  try {
    const p = fn(pluginId)
    return p ? normalize(p) : null
  } catch {
    return null
  }
}

/** 规范化 URL 为可比较前缀：scheme://host[:port] */
export function normalizeUrlPrefix(raw: string): string {
  const s = String(raw ?? '').trim()
  try {
    const u = new URL(s)
    const port = u.port ? `:${u.port}` : ''
    return `${u.protocol}//${u.hostname}${port}`
  } catch {
    return s.toLowerCase()
  }
}

// ---- 符号链接安全解析（修复任务 F1，2026-09-02）----
// 宿主 fs.* 透传插件路径若允许目录内含指向外部的链接（用户放置 / native-host 创建），
// 仅 normalize 前缀匹配即可被绕过。此处将请求路径解析为「最深已存在祖先 realpath + 剩余尾缀」：
//  - 返回的解析后路径与真实 I/O 一致（校验与执行同路径，消除 check→use 二次解析窗口）；
//  - 授权校验在解析后路径上进行：任一已存在组件逃逸授权集 → 拒绝。
// 已存在祖先不存在的尾缀不做解析（未来文件/目录），不存在的中间组件不可能先于文件系统被替换。
// LRU + TTL（2s）压 realpath 系统调用成本；符号链接变更在 TTL 内不生效，可接受（fs 调用本就经 IPC）。

const REALPATH_CACHE_TTL_MS = 2_000
const realpathCache = new Map<string, { at: number; v: string }>()

function realpathCached(p: string): string | null {
  const hit = realpathCache.get(p)
  if (hit && Date.now() - hit.at < REALPATH_CACHE_TTL_MS) return hit.v
  return null
}

function realpathStore(p: string, v: string): void {
  realpathCache.set(p, { at: Date.now(), v })
  if (realpathCache.size > 512) {
    const now = Date.now()
    for (const [k, e] of realpathCache) {
      if (now - e.at >= REALPATH_CACHE_TTL_MS) realpathCache.delete(k)
    }
  }
}

/** 解析候选路径为「最深已存在祖先 realpath + 剩余尾缀」；无法解析（权限等）时原样返回交下层 fs 报错 */
export async function resolveRealSafe(candidate: string): Promise<string> {
  const raw = normalize(String(candidate))
  if (!raw) return raw
  const key = raw
  const hit = realpathCached(key)
  if (hit) return hit
  const suffix: string[] = []
  let cur = raw
  let resolved: string | null = null
  for (;;) {
    const c = realpathCached(cur)
    if (c) {
      resolved = c
      break
    }
    try {
      resolved = await realpath(cur)
      realpathStore(cur, resolved)
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        const parent = dirname(cur)
        if (parent === cur) break // 已到根仍无已存在祖先：放弃解析
        suffix.push(basename(cur))
        cur = parent
        continue
      }
      break // EACCES 等：无法解析，保留原路径让下层 fs 自然报错
    }
  }
  const final = resolved ? (suffix.length ? join(resolved, ...suffix.reverse()) : resolved) : raw
  realpathStore(key, final)
  return final
}

/** win32 路径比较大小写不敏感（realpath 可能输出 C:\ 盘符大写，与用户小写输入不一致） */
function cmpPath(p: string): string {
  const n = normalize(p)
  return process.platform === 'win32' ? n.toLowerCase() : n
}

function isUnderOrEqual(child: string, parent: string): boolean {
  const c = cmpPath(child)
  const p = cmpPath(parent)
  return c === p || c.startsWith(p + sep)
}

function keyOf(pluginId: string, target: string, mode?: FsGrantMode): string {
  return `${pluginId}|${target}|${mode ?? ''}`
}

export class ResourceGrantStore {
  private readonly type: ResourceType
  private readonly file: string
  private persistent = new Map<string, ResourceGrant>()
  private session = new Map<string, ResourceGrant>()
  private temp = new Map<string, TempGrant>()
  /** 旧版（无 pluginId）持久记录：无属主无法直接进索引，等待属主 grant/adopt 时收养（一次性迁移） */
  private orphans = new Map<string, ResourceGrant>()
  private fsDirs = new Map<string, FsDirsDeclaration>()
  private spawnCmds = new Map<string, SpawnCmdsDeclaration>()
  private dirty = false
  private loaded = false
  /** 串行写队列（F10）：grant/revoke 是同步 API，落盘走队列防并发覆盖 + 失败可见 */
  private writeQueue: Promise<void> = Promise.resolve()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(type: ResourceType, file?: string) {
    this.type = type
    this.file = file ?? join(app.getPath('userData'), `${type}-grants.json`)
  }

  /**
   * 启动时加载持久授权（解密；损坏/被篡改 → 原文件改名 .corrupt 留证 + error 日志后降级为空表）。
   * 修复任务 F4（2026-09-02）：不再静默清零；DATA 默认授权不依赖落盘文件，降级不影响基础功能。
   */
  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(this.file, 'utf-8')
      const json = await decryptHost(raw.trim())
      const list = JSON.parse(json) as ResourceGrant[]
      if (!Array.isArray(list)) throw new Error('resource-grants: invalid payload')
      let orphaned = 0
      for (const g of list) {
        if (!g || typeof g.target !== 'string' || g.scope !== 'persistent') continue
        // 修复（F-2026-09-03）：旧记录缺少 pluginId，无法按属主恢复 → 暂存 orphans，由属主启动自
        // 授权 / auth.requestGrants 收养；若始终无人认领则在下次写盘时自然作废（不影响新授权）。
        if (!g.pluginId) {
          this.orphans.set(keyOf('', g.target, g.mode), { ...g, type: g.type ?? this.type })
          orphaned++
          continue
        }
        this.persistent.set(keyOf(g.pluginId, g.target, g.mode), g)
      }
      if (orphaned > 0) {
        logger.warn('security', 'resource-grants loaded orphan records without owner (legacy), awaiting adoption', {
          type: this.type,
          orphaned,
        })
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // 文件存在但解密/解析失败（截断、篡改、版本迁移）：改名留证，重启后不重复踩坏文件
        try {
          await rename(this.file, `${this.file}.corrupt-${Date.now()}`)
        } catch { /* 改名失败（权限等）忽略，不清除现场 */ }
        logger.error('security', 'resource-grants load failed, reset to empty', {
          type: this.type,
          file: this.file,
          error: String((err as Error)?.message ?? err),
        })
      }
      this.persistent.clear()
      this.orphans.clear()
    }
  }

  /** 授权写入（scope=persistent 落盘；scope=session 仅内存） */
  grant(pluginId: string, target: string, opts: { mode?: FsGrantMode; scope?: GrantScope } = {}): void {
    const g: ResourceGrant = {
      type: this.type,
      target: String(target),
      pluginId,
      mode: opts.mode,
      scope: opts.scope ?? 'persistent',
      grantedAt: Date.now(),
    }
    const k = keyOf(pluginId, g.target, g.mode)
    // 同目标同档位存在旧版无主记录 → 直接收养覆盖（避免孤儿随下次写盘作废后重新弹框）
    this.orphans.delete(keyOf('', g.target, g.mode))
    const map = g.scope === 'session' ? this.session : this.persistent
    map.set(k, g)
    if (g.scope === 'persistent') this.markDirty()
  }

  /**
   * 收养旧版无主记录（F-2026-09-03 迁移）：把 target+mode 匹配的无主持久授权归属到 pluginId。
   * 宿主在「属主自目录授权 / auth.requestGrants 命中旧授权」时调用，用户已点过的「始终允许」据此
   * 免重复弹框恢复生效。返回是否找到并收养。
   */
  adopt(pluginId: string, target: string, mode?: FsGrantMode): boolean {
    const k = keyOf('', target, mode)
    const g = this.orphans.get(k)
    if (!g) return false
    this.orphans.delete(k)
    this.persistent.set(keyOf(pluginId, g.target, g.mode), { ...g, pluginId, scope: 'persistent' })
    this.markDirty()
    logger.info('security', 'resource-grant orphan adopted', {
      type: this.type,
      pluginId,
      target: g.target,
      mode: g.mode ?? null,
    })
    return true
  }

  /** 是否已授权（命中持久或会话） */
  has(pluginId: string, target: string, mode?: FsGrantMode): boolean {
    const k = keyOf(pluginId, target, mode)
    return this.persistent.has(k) || this.session.has(k)
  }

  /** 写入临时一次性授权（save 场景；30s TTL + 单次消费） */
  grantTemp(pluginId: string, target: string, opts: { mode?: FsGrantMode; ttlMs?: number } = {}): void {
    this.temp.set(keyOf(pluginId, target, opts.mode), {
      target: String(target),
      mode: opts.mode,
      expiresAt: Date.now() + (opts.ttlMs ?? TEMP_GRANT_TTL_MS),
    })
  }

  /**
   * 消费临时授权（修复任务 F2，2026-09-02）：
   * 命中且未过期 → **提升为该插件会话授权**（同路径同 mode），重存 / 自动保存 / 分块续写不再被拒，直到宿主退出；
   * TTL 仅作「grant 后迟迟不写」的兜底回收，不再按单次消费失效。未命中/过期返回 false。
   */
  consumeTemp(pluginId: string, target: string, mode?: FsGrantMode): boolean {
    const k = keyOf(pluginId, target, mode)
    const g = this.temp.get(k)
    if (!g) return false
    this.temp.delete(k)
    if (g.expiresAt <= Date.now()) return false
    this.session.set(k, {
      type: this.type,
      target: g.target,
      pluginId,
      mode: g.mode,
      scope: 'session',
      grantedAt: Date.now(),
    })
    return true
  }

  /** 撤销某插件的某项资源授权（持久 + 会话）；mode 缺省时删除该 target 全部档位（read/write/无 mode 各键）。
   *  修复任务 F8：撤销写结构化审计日志。fs 授权按 target+mode 分键，市场「权限」页按目录撤销需全档位删除。 */
  revoke(pluginId: string, target: string, mode?: FsGrantMode): void {
    const keys = mode != null
      ? [keyOf(pluginId, target, mode)]
      : [keyOf(pluginId, target, 'read'), keyOf(pluginId, target, 'write'), keyOf(pluginId, target, undefined)]
    let changed = false
    for (const k of keys) {
      if (this.persistent.delete(k) || this.session.delete(k)) changed = true
    }
    if (changed) {
      logger.info('security', 'resource-grant revoked', {
        type: this.type,
        pluginId,
        target,
        mode: mode ?? null,
      })
      this.markDirty()
    }
  }

  /** 撤销某插件全部资源授权（卸载 / 覆盖安装用）；修复任务 F8：批量撤销写结构化审计日志 */
  revokeByPlugin(pluginId: string): void {
    const prefix = `${pluginId}|`
    let changed = false
    let revokedTargets = 0
    for (const [k] of this.persistent) {
      if (k.startsWith(prefix)) {
        this.persistent.delete(k)
        revokedTargets++
        changed = true
      }
    }
    for (const k of this.session.keys()) {
      if (k.startsWith(prefix)) {
        this.session.delete(k)
        revokedTargets++
      }
    }
    this.fsDirs.delete(pluginId)
    this.spawnCmds.delete(pluginId)
    if (changed) {
      logger.info('security', 'resource-grants cleared for plugin', {
        type: this.type,
        pluginId,
        revokedTargets,
      })
      this.markDirty()
    }
  }

  /** 列出某插件的授权（持久 + 会话；市场「权限」页展示用） */
  list(pluginId: string): ResourceGrant[] {
    const prefix = `${pluginId}|`
    const out: ResourceGrant[] = []
    for (const [k, g] of this.persistent) if (k.startsWith(prefix)) out.push(g)
    for (const [k, g] of this.session) if (k.startsWith(prefix)) out.push(g)
    return out
  }

  /**
   * 注册 manifest.fsDirs（插件启动时；fs 专用）。
   * 修复任务 F5（2026-09-02）：注册时即解析各目录项，别名解析失败（如 RECENT on Linux）→ warn 结构化日志，
   * 避免运行时静默降权造成「声明了权限却读不到文件」的困惑。
   */
  registerFsDirs(pluginId: string, decl: FsDirsDeclaration | undefined): void {
    if (this.type !== 'fs') return
    if (!decl || (!decl.read?.length && !decl.write?.length)) {
      this.fsDirs.delete(pluginId)
      return
    }
    this.fsDirs.set(pluginId, { read: decl.read ?? [], write: decl.write ?? [] })
    const check = (dir: string, mode: 'read' | 'write'): void => {
      const isAlias = !dir.includes('/') && !dir.includes('\\')
      if (!isAlias) return
      const resolved = resolveDirAlias(dir, pluginId)
      if (!resolved) {
        logger.warn('security', 'fsDirs alias unavailable on this OS', {
          pluginId,
          alias: dir,
          mode,
          reason: 'resolveDirAlias returned null (alias unsupported on current platform, e.g. RECENT on Linux)',
        })
      }
    }
    for (const r of decl.read ?? []) check(r, 'read')
    for (const w of decl.write ?? []) check(w, 'write')
  }

  /** 注册 manifest.spawnCmds（插件启动时；spawn 专用）。
   *  F9：支持规则（string | {cmd,argsPattern}）；string 项/无约束对象注册时 warn 一次（无参数约束提示）。 */
  registerSpawnCmds(pluginId: string, decl: SpawnCmdsDeclaration | undefined): void {
    if (this.type !== 'spawn') return
    if (!decl || !decl.cmds?.length) {
      this.spawnCmds.delete(pluginId)
      return
    }
    this.spawnCmds.set(pluginId, { cmds: decl.cmds })
    for (const rule of decl.cmds) {
      if (typeof rule === 'string') {
        logger.warn('security', 'spawnCmds rule without args constraint', { pluginId, cmd: rule })
      } else if (!rule.argsPattern) {
        logger.warn('security', 'spawnCmds rule without argsPattern (args unrestricted)', { pluginId, cmd: rule.cmd })
      } else if (rule.argsPattern.length > SPAWN_PATTERN_MAX_LEN) {
        logger.warn('security', 'spawnCmds argsPattern too long, treated as unconstrained', {
          pluginId,
          cmd: rule.cmd,
          max: SPAWN_PATTERN_MAX_LEN,
        })
      }
    }
  }

  /** fs 路径白名单校验：DATA（默认）+ fsDirs + grants（持久/会话） */
  isPathAllowed(pluginId: string, absPath: string, mode: FsGrantMode): boolean {
    const target = normalize(String(absPath))
    // 插件数据目录默认授予
    const data = resolveDirAlias('DATA', pluginId)
    if (data && isUnderOrEqual(target, data)) return true
    // 运行时授权（精确/目录前缀匹配）
    for (const [k, g] of this.persistent) {
      if (k.startsWith(`${pluginId}|`) && isUnderOrEqual(target, g.target) && (!g.mode || g.mode === mode)) return true
    }
    for (const [k, g] of this.session) {
      if (k.startsWith(`${pluginId}|`) && isUnderOrEqual(target, g.target) && (!g.mode || g.mode === mode)) return true
    }
    // 临时一次性授权（save 场景；命中即消费，仅一次）
    if (this.consumeTemp(pluginId, target, mode)) return true
    // manifest 声明的 fsDirs
    const decl = this.fsDirs.get(pluginId)
    const list = mode === 'write' ? decl?.write ?? [] : [...(decl?.read ?? []), ...(decl?.write ?? [])]
    for (const raw of list) {
      const dir = raw.includes('/') || raw.includes('\\') ? normalize(raw) : resolveDirAlias(raw, pluginId)
      if (dir && isUnderOrEqual(target, dir)) return true
    }
    return false
  }

  /** net URL 白名单校验：域名/URL 前缀匹配 grants（持久/会话） */
  isUrlAllowed(pluginId: string, url: string): boolean {
    const prefix = normalizeUrlPrefix(url)
    if (!prefix) return false
    const check = (map: Map<string, ResourceGrant>): boolean => {
      for (const [k, g] of map) {
        if (!k.startsWith(`${pluginId}|`)) continue
        const t = normalizeUrlPrefix(g.target)
        if (t && (prefix === t || prefix.startsWith(t))) return true
      }
      return false
    }
    return check(this.persistent) || check(this.session)
  }

  /**
   * spawn 命令白名单校验（F9，带参数三态）：插件运行目录 / node_modules/.bin / 运行时授权（cmd 级）→ allow；
   * spawnCmds 规则：string 项 → allow（参数不限）；对象项需逐参数匹配 argsPattern，违约 → args-denied；均未命中 → nomatch。
   */
  isSpawnAllowed(pluginId: string, cmd: string, args: string[] = []): SpawnVerdict {
    const c = String(cmd)
    if (!c) return 'nomatch'
    // NODEJS 官方运行时根（nodejs 插件下载解压的 USER_DATA/plugin-data/nodejs）：宿主受控目录
    // （官方发行包，nodejs.install 写入），作为所有插件 spawn 内置 node / npm-cli.js 的 allow 前缀，
    // 免 spawn-confirm（spec §5.4 规划；调用方自身的 child.spawn 权限仍由宿主按 manifest 裁决）。
    const nodejsRoot = join(app.getPath('userData'), 'plugin-data', 'nodejs')
    if (isUnderOrEqual(c, nodejsRoot)) return 'allow'
    // 插件运行目录（plugin-data/<pluginId>）与 node_modules/.bin：插件自装二进制，参数不限（同安装级信任）
    const data = resolveDirAlias('DATA', pluginId)
    // dev 实例（'<id>@dev'）的 worker 仍可能使用共享的 plugin-data/<id>（nodejs 等自装运行时目录不带 @dev
    // 后缀），DATA 键含后缀会导致漏判 → 兜底按逻辑 id 再查一次，cmd 落在任一即放行。
    const baseId = pluginId.replace(/@dev$/, '')
    const dataBase = baseId !== pluginId ? resolveDirAlias('DATA', baseId) : null
    const baseBin = dataBase ? join(dataBase, 'node_modules', '.bin') : null
     const bin = data ? join(data, 'node_modules', '.bin') : null
     if (data && isUnderOrEqual(c, data)) return 'allow'
    if (bin && isUnderOrEqual(c, bin)) return 'allow'
    if (dataBase && isUnderOrEqual(c, dataBase)) return 'allow'
    if (baseBin && isUnderOrEqual(c, baseBin)) return 'allow'
    // 运行时授权（命令精确匹配；用户弹框显式授权该 cmd → 参数不限，取舍见 §5.4）
    if (this.has(pluginId, c)) return 'allow'
    // manifest 声明的 spawnCmds 规则
    const decl = this.spawnCmds.get(pluginId)
    for (const rule of decl?.cmds ?? []) {
      const target = typeof rule === 'string' ? rule : rule.cmd
      if (target !== c && target !== normalize(c)) continue
      if (typeof rule === 'string') return 'allow' // 旧格式：仅命令、参数不限
      if (!rule.argsPattern) return 'allow'
      const re = compileSpawnPattern(rule.argsPattern)
      if (!re) return 'allow' // 非法/超长 pattern：注册期已 warn，这里不额外收紧
      const a = Array.isArray(args) ? args.map(String) : []
      if (a.length <= SPAWN_ARGS_MAX && a.every((x) => x.length <= SPAWN_ARG_MAX_LEN && re.test(x))) return 'allow'
      return 'args-denied'
    }
    return 'nomatch'
  }

  /** 标记脏并调度防抖写盘（F10）：同步 API 不阻塞调用方，失败在队列内记录并保留脏标重试 */
  private markDirty(): void {
    this.dirty = true
    if (this.persistTimer) return // 已有排队的防抖写
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.schedulePersist()
    }, GRANT_PERSIST_DEBOUNCE_MS)
  }

  /** 排入串行写队列（错误不外泄到调用方，记日志 + 保留 dirty 供下次重试） */
  private schedulePersist(): void {
    this.writeQueue = this.writeQueue.then(() => this.persist()).catch((err) => {
      logger.error('security', 'resource-grants persist failed, will retry on next change', {
        type: this.type,
        file: this.file,
        error: String((err as Error)?.message ?? err),
      })
      this.dirty = true
    })
  }

  /** 立即写盘（宿主退出前 await 保证落盘；幂等）。F10 新增。 */
  flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (this.dirty) this.schedulePersist()
    return this.writeQueue
  }

  /** 加密写盘（仅持久授权；session 不落盘）。串行队列内执行：取“执行时最新快照”防覆盖丢失 */
  private async persist(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    const payload = Array.from(this.persistent.values())
    const b64 = await encryptHost(JSON.stringify(payload))
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, b64, 'utf-8')
  }

  /** 测试/调试：持久授权条数 */
  size(): number {
    return this.persistent.size
  }
}

/** 会话级授权：宿主退出即失效（无持久化）；此处仅提供语义标注，实际以 session map 承载 */
export const SESSION_GRANT_SCOPE: GrantScope = 'session'
