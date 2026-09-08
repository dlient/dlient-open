/**
 * lib/child.ts - child 模块复杂实现（方案 v2：子进程管理下沉 lib；api/child.ts 与 api/app.ts 引用）。
 * 宿主代 spawn（child.spawn / child.execFile / app.createNative*）、kill、child-event 推送、
 * 缓冲句柄与 native-host 入口定位统一在此收敛。
 * 命令白名单 + spawn-confirm 运行时授权由 lib/grants.ts authorizeSpawn 裁决（manifest.permissions
 * 声明通过后的第二层资源校验，机制不变）。
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DlientError, DlientErrorCode } from '@dlient-open/core'
import { killChild, registerChild } from '../child-registry'
import { authorizeSpawn, registerGrantHooks, type ResourceAccessHooks } from './grants'

/** 宿主装配注入资源级授权 hooks（dialog / net / spawn 授权流 + executeHostApi system 判定）：
 * grants 转发 + 本模块 child-event 推送通道（resourceAccess?.sendToWorker 转发）。 */
export function registerResourceAccessHooks(hooks: ResourceAccessHooks | null): void {
  registerGrantHooks(hooks)
  // pushChildEvent 的推送通道（worker 收 child-event 分发）
  registerChildEventSender(hooks ? (pluginId, child) => hooks.sendToWorker?.(pluginId, { type: 'child-event', child }) : null)
}

// ---- 子进程句柄（child.spawn 缓冲输出；句柄内聚后 kill/stdin 经控制消息通道、输出/退出经订阅回放）----
/** 句柄事件缓冲上限（订阅前产生的 stdout/stderr/exit 缓存在此，订阅后回放；超限丢最旧） */
const CHILD_EVENT_BUFFER_LIMIT = 512

/** 宿主进程内完整句柄（hostSpawnChild / createNativeHostProcess 返回；kill/write/end/快照内聚）。
 * 跨进程出口（child.spawn host-api / app.createNative*）用 toSpawnRef 序列化为 { handleId, pid }。 */
export interface SpawnHandle {
  readonly handleId: string
  readonly pid: number
  /** 幂等树杀 + 注销（已退出/已注销 → { ok:false, reason:'not-found' }） */
  kill(): Promise<{ ok: boolean; reason?: string }>
  /** 写 stdin（native-host RPC 双向通信；句柄以 stdin=pipe 拉起） */
  write(data: unknown): { ok: boolean; reason?: string }
  /** 结束 stdin（优雅关闭信号；native-host server 收到 EOF 后走 onClose） */
  end(): { ok: boolean; reason?: string }
  /** 缓冲输出与退出状态快照（宿主侧诊断/回收用；句柄已注销返回空态） */
  snapshot(): { stdout: string; stderr: string; exited: boolean; code: number | null; signal: NodeJS.Signals | null }
}

/** child.spawn host-api 跨进程返回（worker 侧不透明标识；完整操作在 SDK ChildHandle 上） */
export interface SpawnRef {
  handleId: string
  pid: number
}

/** 进程内完整句柄 → 跨进程标识 */
export function toSpawnRef(h: SpawnHandle): SpawnRef {
  return { handleId: h.handleId, pid: h.pid }
}

interface SpawnHandleRecord {
  handleId: string
  pid: number
  proc: ChildProcess
  /** owner instanceKey（worker 退出时按 owner 清理 spawnHandles） */
  owner: string
  stdout: string
  stderr: string
  exited: boolean
  code: number | null
  signal: NodeJS.Signals | null
  /** 句柄内聚：worker 是否已订阅（child-subscribe）。未订阅 → 事件只进缓冲不实时推；订阅后回放 + 实时推 */
  subscribed: boolean
  /** 事件缓冲（订阅前的事件经回放补齐，消除「spawn 返回前已产生输出/退出」的注册竞态） */
  events: HostedChildEvent[]
}
const spawnHandles = new Map<string, SpawnHandleRecord>()
let spawnSeq = 0

/** worker 退出 → 按 owner 清理其宿主代管子进程句柄（进程本身由 child-registry killChildrenByOwner 兜底） */
export function clearHostedSpawnsByOwner(owner: string): void {
  for (const [handleId, rec] of spawnHandles) {
    if (rec.owner === owner) spawnHandles.delete(handleId)
  }
}

/** spawn env 剥离：仅保留 PATH/HOME + 插件显式传入项（与 native-host 一致） */
function strippedSpawnEnv(env?: Record<string, string>): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = {}
  if (process.env.PATH) base.PATH = process.env.PATH
  if (process.env.HOME) base.HOME = process.env.HOME
  return { ...base, ...(env ?? {}) } as NodeJS.ProcessEnv
}

// ---- child-event 推送通道注入（pushChildEvent 的 resourceAccess?.sendToWorker 替代；装配时注册）----
export interface HostedChildEvent {
  handleId: string
  event: 'stdout' | 'stderr' | 'exit' | 'error'
  data?: string
  code?: number | null
  signal?: string | null
}
type ChildEventSender = (pluginId: string, child: HostedChildEvent) => void
let childEventSender: ChildEventSender | null = null

/** 宿主装配注入：向所属插件 worker 推送 child-event 的通道（export.ts registerResourceAccessHooks 转发） */
export function registerChildEventSender(fn: ChildEventSender | null): void {
  childEventSender = fn
}

/**
 * 向所属插件 worker 推送 child-event（流式输出/退出；SDK 按 handleId 分发到 ChildHandle 回调）。
 * 句柄内聚订阅模型：事件一律先进缓冲；句柄已被 worker 订阅（child-subscribe）时才实时推送，
 * 未订阅场景由 subscribeChildHandle 回放补齐（消除 spawn 返回前的注册竞态，替代原 readOutput 轮询）。
 */
function pushChildEvent(child: HostedChildEvent): void {
  const rec = spawnHandles.get(child.handleId)
  if (!rec) return
  rec.events.push(child)
  if (rec.events.length > CHILD_EVENT_BUFFER_LIMIT) rec.events.shift()
  if (rec.subscribed) childEventSender?.(rec.owner, child)
}

/**
 * worker 订阅句柄事件（child-subscribe）：置订阅标记后回放缓冲事件，此后事件实时推送。
 * owner 必须等于句柄属主（instanceKey），防跨插件订阅他人句柄。
 */
export function subscribeChildHandle(owner: string, handleId: string): void {
  const rec = spawnHandles.get(String(handleId ?? ''))
  if (!rec || rec.owner !== String(owner ?? '')) return
  rec.subscribed = true
  for (const ev of rec.events) childEventSender?.(rec.owner, ev)
}

/** 句柄控制（child-control 消息通道：kill / write / end；句柄内聚后不再走 host-api） */
export async function childHandleControl(
  owner: string,
  handleId: string,
  op: 'kill' | 'write' | 'end',
  data?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const rec = spawnHandles.get(String(handleId ?? ''))
  if (!rec) return { ok: false, reason: 'not-found' }
  if (rec.owner !== String(owner ?? '')) return { ok: false, reason: 'not-owner' }
  if (op === 'kill') return hostKillChild(handleId)
  if (op === 'write') return writeSpawnStdin(handleId, data)
  return endSpawnStdin(handleId)
}

// ---- native-host 入口定位注入（locatePluginDist 用 devPluginManager.getDirInfo / installerHooks.scanInstalled）----
type DevDirProvider = (pluginId: string) => { dir: string; dist: string } | null
let devDirProvider: DevDirProvider | null = null

/** 宿主装配注入 dev 目录 provider（export.ts registerDevPluginManager 转发 devPluginManager.getDirInfo） */
export function registerDevDirProvider(fn: DevDirProvider | null): void {
  devDirProvider = fn
}

type InstalledScanner = () => Array<{ id?: string; path?: string }>
let installedScanner: InstalledScanner | null = null

/** 宿主装配注入已安装插件扫描 provider（export.ts registerPluginInstallerHooks 转发 installerHooks.scanInstalled） */
export function registerInstalledScanner(fn: InstalledScanner | null): void {
  installedScanner = fn
}

/** 定位插件真实目录 + dist（dev 实例优先，其次 installed 记录）。createNativeHostProcess 宿主侧用 */
function locatePluginDist(pluginId: string): { path: string; dist: string } | null {
  const dev = devDirProvider?.(pluginId)
  if (dev) return { path: dev.dir, dist: dev.dist }
  const list = installedScanner?.() ?? []
  const rec = list.find((p) => String(p.id ?? '') === pluginId)
  if (!rec?.path) return null
  let dist = 'dist'
  try {
    const pkg = JSON.parse(readFileSync(join(rec.path, 'package.json'), 'utf-8')) as { dlient?: { dist?: unknown } }
    if (typeof pkg.dlient?.dist === 'string' && pkg.dlient.dist) dist = pkg.dlient.dist
  } catch {
    /* 缺省 dist */
  }
  return { path: rec.path, dist }
}

// ---- 宿主代 spawn 公共实现（child.spawn / app.createNativeClient 共用）：授权 → spawn → 登记 → 返回句柄 ----
export interface SpawnOptions {
  cmd?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  detached?: boolean
  description?: string
}

export async function hostSpawnChild(pluginId: string, o: SpawnOptions): Promise<SpawnHandle> {
  const cmd = String(o.cmd ?? '')
  if (!cmd) throw new DlientError(DlientErrorCode.INVALID, 'spawn: cmd required')
  const spawnAuth = await authorizeSpawn(pluginId, cmd, o.args ?? [], o.description)
  if (!spawnAuth.ok) throw new DlientError(DlientErrorCode.USER_DENIED, 'user denied spawn')
  const proc: ChildProcess = spawn(cmd, o.args ?? [], {
    cwd: o.cwd,
    env: strippedSpawnEnv(o.env),
    detached: o.detached ?? process.platform !== 'win32',
    windowsHide: true,
    // stdin=pipe：native-host RPC 需经 child.writeStdin 双向通信；stdout/stderr=pipe 供 child-event 流式推送
    stdio: ['pipe', 'pipe', 'pipe'] as const,
  })
  const handleId = `spawn-${++spawnSeq}`
  const rec: SpawnHandleRecord = {
    handleId,
    pid: proc.pid ?? 0,
    proc,
    owner: pluginId,
    stdout: '',
    stderr: '',
    exited: false,
    code: null,
    signal: null,
    subscribed: false,
    events: [],
  }
  spawnHandles.set(handleId, rec)
  proc.stdout?.on('data', (d: Buffer) => {
    rec.stdout += String(d)
    pushChildEvent({ handleId, event: 'stdout', data: String(d) })
  })
  proc.stderr?.on('data', (d: Buffer) => {
    rec.stderr += String(d)
    pushChildEvent({ handleId, event: 'stderr', data: String(d) })
  })
  proc.on('error', (err) => {
    /* spawn 失败（如命令不存在）：error 后也会触发 close */
    pushChildEvent({ handleId, event: 'error', data: err instanceof Error ? err.message : String(err) })
  })
  proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    rec.exited = true
    rec.code = code
    rec.signal = signal
    pushChildEvent({ handleId, event: 'exit', code, signal })
  })
  if (rec.pid) registerChild({ pid: rec.pid, owner: pluginId, cmd })
  // 进程内完整句柄：kill/write/end/快照绑定到本句柄记录（宿主内部组合用；跨进程出口经 toSpawnRef）
  return {
    handleId,
    pid: rec.pid,
    kill: () => hostKillChild(handleId),
    write: (data: unknown) => writeSpawnStdin(handleId, data),
    end: () => endSpawnStdin(handleId),
    snapshot: () => ({ stdout: rec.stdout, stderr: rec.stderr, exited: rec.exited, code: rec.code, signal: rec.signal }),
  }
}

/** 宿主代 execFile（一次性捕获，探测类，如 node --version）：授权 → 执行 → 返回 stdout/stderr/code */
export async function execFileChild(pluginId: string, o: SpawnOptions & { timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }> {
  const cmd = String(o.cmd ?? '')
  if (!cmd) throw new DlientError(DlientErrorCode.INVALID, 'child.execFile: cmd required')
  const spawnAuth = await authorizeSpawn(pluginId, cmd, o.args ?? [], o.description)
  if (!spawnAuth.ok) throw new DlientError(DlientErrorCode.USER_DENIED, 'user denied spawn')
  return new Promise((resolve) => {
    execFile(
      cmd,
      o.args ?? [],
      {
        cwd: o.cwd,
        env: strippedSpawnEnv(o.env),
        timeout: o.timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        // err=null 表示正常退出 → code 0；有 err 时优先取 err.code（数字），否则 -1。
        // 修复前成功路径误判为 -1，导致 nodejs.checkLocal/checkBundled 探测永远失败。
        const ec = (err as { code?: unknown } | null)?.code
        const code = err ? (typeof ec === 'number' ? (ec as number) : -1) : 0
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code })
      },
    )
  })
}

/** 宿主代 kill 公共实现（child.kill / app.disposeNativeClient 共用）：按句柄树杀 + 注销 */
export async function hostKillChild(handleId: string): Promise<{ ok: boolean; reason?: string }> {
  const rec = spawnHandles.get(String(handleId ?? ''))
  if (!rec) return { ok: false, reason: 'not-found' }
  if (rec.pid) await killChild(rec.pid)
  spawnHandles.delete(String(handleId))
  return { ok: true }
}

/** 写子进程 stdin（native-host RPC 双向通信；child.spawn 以 stdin=pipe 拉起；child-control write 落地） */
export function writeSpawnStdin(handleId: string, data: unknown): { ok: boolean; reason?: string } {
  const rec = spawnHandles.get(String(handleId ?? ''))
  if (!rec || !rec.proc.stdin?.writable) return { ok: false, reason: 'not-writable' }
  const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? String(data) : JSON.stringify(data ?? '')
  rec.proc.stdin.write(text)
  return { ok: true }
}

/** 结束子进程 stdin（优雅关闭信号；native-host server 收到 EOF 后走 onClose；child-control end 落地） */
export function endSpawnStdin(handleId: string): { ok: boolean; reason?: string } {
  const rec = spawnHandles.get(String(handleId ?? ''))
  if (!rec?.proc.stdin?.writable) return { ok: false, reason: 'not-writable' }
  rec.proc.stdin.end()
  return { ok: true }
}

/** app.createNativeHost：宿主按插件 dist 查找 native-host 入口并代 spawn 官方 Node
 * （SDK rpc.createNativeHost 内部使用；node 来自 nodejs.resolveRuntime，白名单免确认） */
export async function createNativeHostProcess(pluginId: string, o: { fileName?: string; node?: string }): Promise<SpawnHandle> {
  const fileName = String(o.fileName ?? '').trim()
  const node = String(o.node ?? '')
  // fileName 仅限 dist 内单一文件名：拒绝路径穿越（.. / 分隔符）与危险字符
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\') || /[:*?"<>|]/.test(fileName)) {
    throw new DlientError(DlientErrorCode.INVALID, 'app.createNativeHost: invalid fileName')
  }
  if (!node) throw new DlientError(DlientErrorCode.INVALID, 'app.createNativeHost: node required')
  const located = locatePluginDist(String(pluginId ?? ''))
  if (!located) throw new DlientError(DlientErrorCode.TARGET_NOT_FOUND, 'app.createNativeHost: plugin dir not found')
  const entry = join(located.path, located.dist, fileName)
  if (!existsSync(entry)) throw new DlientError(DlientErrorCode.NOT_INSTALLED, `app.createNativeHost: entry not found: ${fileName}`)
  return hostSpawnChild(String(pluginId ?? ''), {
    cmd: node,
    args: [entry],
    cwd: located.path,
    description: 'native-host',
  })
}
