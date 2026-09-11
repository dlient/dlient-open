/**
 * child-registry.ts - 宿主子进程注册中心（通用进程清理平台，阶段二）。
 *
 * 职责：任何插件（经 host-api `child.spawn`）spawn 的子进程在此登记；
 *       worker 退出 / 宿主退出时按 owner（instanceKey）全量 kill，防止孤儿进程。
 * 宿主**不亲自 spawn**，只负责登记 + 兜底清理（宿主是唯一能感知 worker exit 与宿主退出的地方）。
 *
 * 清理分层（见 docs/todo/12-dev-runtime.md §12.3.3）：
 *  - L1 结构：Windows 不 detached（`taskkill /T` 整树）；POSIX detached 新进程组（`kill(-pid)` 整组）
 *  - L2 触发：worker exit → killChildrenByOwner；宿主 will-quit → killAllChildren
 *  - L3 兜底：pid 文件（跨会话：宿主被强杀时 will-quit 不会触发）→ 下次启动交给 reaper 脚本收割
 *
 * 登记同时会通知常驻 reaper（见 reaper.ts）：宿主进程一旦结束，reaper 立刻按登记清单收割，
 * 不必等下次启动。L3 则把「上次会话残留的 pid 文件」喂给一次性 reaper 收割（同一套校验逻辑）。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { logger } from '@dlient-open/core'
import { reapStale, trackChild, untrackChild, type StaleRecord } from './reaper'

export interface ChildEntry {
  pid: number
  /** 发起方实例键（executeHostApi 注入的调用方插件 id，即 instanceKey） */
  owner: string
  cmd: string
  /** POSIX 进程组 id（spawn 时 detached=true 则 = pid）；Windows 用 taskkill /T 整树 */
  groupId?: number
  createdAt: number
}

const registry = new Map<number, ChildEntry>()

/** pid 文件目录（跨会话残留兜底）：<userData>/child-pids/<pid>.json */
function pidFileDir(): string {
  return join(app.getPath('userData'), 'child-pids')
}

/** 登记子进程（宿主代 spawn 成功后调用） */
export function registerChild(entry: Omit<ChildEntry, 'createdAt'>): void {
  const full: ChildEntry = { ...entry, createdAt: Date.now() }
  registry.set(entry.pid, full)
  try {
    const dir = pidFileDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${entry.pid}.json`), JSON.stringify(full))
  } catch {
    /* pid 文件写入失败不影响主流程 */
  }
  // 通知常驻 reaper（懒启动）：宿主结束即由它收割该进程树
  trackChild(entry.pid, entry.cmd, full.createdAt)
  logger.debug('child', `registered pid=${entry.pid} owner=${entry.owner} cmd=${entry.cmd}`)
}

/** 注销子进程（正常清理后调用） */
export function unregisterChild(pid: number): void {
  registry.delete(pid)
  untrackChild(pid)
  try {
    rmSync(join(pidFileDir(), `${pid}.json`), { force: true })
  } catch {
    /* 忽略 */
  }
}

/** 进程是否仍存活（无权限查询也视为存活，交由 kill 结果裁决） */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== 'ESRCH'
  }
}

/**
 * 杀整棵进程树（Windows taskkill /T /F；POSIX 进程组 SIGKILL 回退单 pid）。
 * 异步 spawn + 等待退出：既消除 spawnSync 对主进程事件循环的同步阻塞，
 * 又保持「杀完才返回」的时序语义（dev 热启动 = 先清旧子进程树再启新 worker，不可 fire-and-forget）。
 *
 * 返回值：true = 确实杀掉了目标（Windows taskkill 退出码 0）；false = 失败或目标不存在。
 */
export async function killProcessTree(pid: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const code = await new Promise<number>((resolve) => {
        const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        child.on('error', () => resolve(-1))
        child.on('close', (c) => resolve(c ?? -1))
      })
      return code === 0
    }
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      process.kill(pid, 'SIGKILL')
    }
    return true
  } catch {
    return false
  }
}

/** 杀指定子进程并注销。杀失败且进程仍存活时**保留**登记记录（下次启动可继续兜底），
 *  避免「一次杀失败就永久丢掉线索、残留进程再无人认领」。 */
export async function killChild(pid: number): Promise<void> {
  const entry = registry.get(pid)
  const ok = await killProcessTree(entry?.groupId ?? pid)
  if (ok || !isAlive(pid)) unregisterChild(pid)
}

/** 按 owner（instanceKey）全量 kill —— worker 退出时调用 */
export async function killChildrenByOwner(owner: string): Promise<void> {
  for (const pid of Array.from(registry.keys())) {
    if (registry.get(pid)?.owner === owner) await killChild(pid)
  }
}

/** 全量 kill —— 宿主 will-quit 时调用（fire-and-forget：宿主即将退出，无需等待；
 *  未跑完的部分由常驻 reaper 接管，其次由下次启动的 L3 兜底） */
export function killAllChildren(): void {
  void (async () => {
    for (const pid of Array.from(registry.keys())) await killChild(pid)
  })()
}

/** 列出已登记子进程 */
export function listChildren(): ChildEntry[] {
  return Array.from(registry.values())
}

/** 查询某 pid 的 owner（未登记返回 undefined） */
export function getChildOwner(pid: number): string | undefined {
  return registry.get(pid)?.owner
}

/**
 * 宿主启动兜底（L3）：读上次会话残留的 pid 文件，交给一次性 reaper 收割
 * （识别「登记进程已死、后代成孤儿」并清掉后代；reaper 侧做映像名 + 创建时间双校验，避免误杀）。
 * reaper 脚本不可用时退回「按登记 pid 杀整树」。处理完删除 pid 文件（记录已交给 reaper 内存持有）。
 */
export async function cleanupStaleChildren(): Promise<void> {
  const dir = pidFileDir()
  if (!existsSync(dir)) return
  const files: Array<{ file: string; record: StaleRecord }> = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const full = join(dir, name)
    try {
      const data = JSON.parse(readFileSync(full, 'utf-8')) as Partial<ChildEntry>
      if (typeof data.pid !== 'number' || data.pid <= 0) {
        rmSync(full, { force: true })
        continue
      }
      // 旧版本记录没有 createdAt → 用 pid 文件 mtime 兜底（≈登记时刻），供 PID 复用校验
      const createdAt =
        typeof data.createdAt === 'number' && data.createdAt > 0 ? data.createdAt : statSync(full).mtimeMs
      files.push({
        file: full,
        record: { pid: data.pid, cmd: typeof data.cmd === 'string' ? data.cmd : undefined, createdAt },
      })
    } catch {
      rmSync(full, { force: true })
    }
  }
  if (files.length === 0) return

  const records = files.map((f) => f.record)
  if (!reapStale(records)) {
    for (const r of records) await killProcessTree(r.pid)
  }
  for (const f of files) rmSync(f.file, { force: true })
}
