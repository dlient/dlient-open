/**
 * child-registry.ts - 宿主子进程注册中心（通用进程清理平台，阶段二）。
 *
 * 职责：任何插件（经 SDK `spawnTracked` 上报）spawn 的子进程在此登记；
 *       worker 退出 / 宿主退出时按 owner（instanceKey）全量 kill，防止孤儿进程。
 * 宿主**不亲自 spawn**，只负责登记 + 兜底清理（宿主是唯一能感知 worker exit 与宿主退出的地方）。
 *
 * 清理分层（见 docs/todo/12-dev-runtime.md §12.3.3）：
 *  - L1 结构：Windows Job Object（spawn 不 detached，随 worker 进程组自动终止）
 *  - L2 触发：worker exit / 宿主 will-quit → killChildrenByOwner / killAllChildren
 *  - L3 兜底：pid 文件（跨会话，宿主强杀后下次启动 cleanupStaleChildren）
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { logger } from '@dlient-open/core'

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

/** 登记子进程（SDK spawnTracked 上报后调用） */
export function registerChild(entry: Omit<ChildEntry, 'createdAt'>): void {
  registry.set(entry.pid, { ...entry, createdAt: Date.now() })
  try {
    const dir = pidFileDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${entry.pid}.json`),
      JSON.stringify({ pid: entry.pid, owner: entry.owner, cmd: entry.cmd, groupId: entry.groupId }),
    )
  } catch {
    /* pid 文件写入失败不影响主流程 */
  }
  logger.debug('child', `registered pid=${entry.pid} owner=${entry.owner} cmd=${entry.cmd}`)
}

/** 注销子进程（正常清理后调用） */
export function unregisterChild(pid: number): void {
  registry.delete(pid)
  try {
    rmSync(join(pidFileDir(), `${pid}.json`), { force: true })
  } catch {
    /* 忽略 */
  }
}

/**
 * 杀整棵进程树（Windows taskkill /T /F；POSIX 进程组 SIGKILL 回退单 pid）。
 * 异步 spawn + 等待退出：既消除 spawnSync 对主进程事件循环的同步阻塞，
 * 又保持「杀完才返回」的时序语义（dev 热启动 = 先清旧子进程树再启新 worker，不可 fire-and-forget）。
 */
export async function killProcessTree(pid: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        child.on('error', () => resolve())
        child.on('close', () => resolve())
      })
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        process.kill(pid, 'SIGKILL')
      }
    }
    return true
  } catch {
    return false
  }
}

/** 杀指定子进程并注销 */
export async function killChild(pid: number): Promise<void> {
  const entry = registry.get(pid)
  await killProcessTree(entry?.groupId ?? pid)
  unregisterChild(pid)
}

/** 按 owner（instanceKey）全量 kill —— worker 退出时调用 */
export async function killChildrenByOwner(owner: string): Promise<void> {
  for (const pid of Array.from(registry.keys())) {
    if (registry.get(pid)?.owner === owner) await killChild(pid)
  }
}

/** 全量 kill —— 宿主 will-quit 时调用（fire-and-forget：宿主即将退出，无需等待） */
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

/** 宿主启动时清理上次残留（pid 文件存在 → 进程可能仍存活，整树 kill + 删文件） */
export async function cleanupStaleChildren(): Promise<void> {
  const dir = pidFileDir()
  if (!existsSync(dir)) return
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const full = join(dir, file)
    try {
      const data = JSON.parse(readFileSync(full, 'utf-8')) as { pid: number }
      if (typeof data.pid === 'number') await killProcessTree(data.pid)
    } catch {
      /* 文件损坏忽略 */
    }
    rmSync(full, { force: true })
  }
}
