/**
 * file-queue.ts - 主进程文件操作 per-path 串行队列 + 原子写 + 跨进程锁原语。
 *
 * 背景（docs/todo/01-file-lock.md）：
 *  - host-api 的 fs.* / app.data.* 与主进程自身（installed-registry / dev-plugins）都在主进程执行，
 *    但此前互不协调：同一文件的两个并发写可重叠 → Windows EPERM / 丢失更新 / 半写状态。
 *  - 本模块对文件路径做互斥串行（同路径排队、不同路径并行），写文件统一走原子写（tmp + rename）。
 *
 * 覆盖范围：主进程内全部文件写（含 worker 经 host-api 的写——执行点都在主进程，队列即可收敛）。
 * 跨进程（worker 直接 import 'node:fs' 绕过宿主）见 fs.lock / fs.withLock 与锁标记文件约定
 * （docs/guides/plugin-development.md §10「文件访问规范」）。
 */

import { basename, dirname, join, normalize } from 'node:path'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { DlientError, DlientErrorCode } from '@dlient-open/core'

let seq = 0

/** 路径互斥键：绝对路径规范化；Windows 文件系统不区分大小写 → 统一小写 */
function normalizeKey(filePath: string): string {
  const p = normalize(filePath)
  return process.platform === 'win32' ? p.toLowerCase() : p
}

// ---- per-path 串行队列（P0，todo 1.3.1）----

const tails = new Map<string, Promise<void>>()

/**
 * per-path 互斥执行：同一路径的后续任务排队等待前一个完成，不同路径并行。
 * - 返回本次任务的 Promise（reject 原样透传给调用方，不吞错）；
 * - 链尾记录清理任务（吞错），保证失败也不卡死队列；任务完成后自动移除该路径条目，防止 Map 无限增长。
 */
export function withFileLock<T>(filePath: string, fn: () => T | Promise<T>): Promise<T> {
  const key = normalizeKey(filePath)
  const prev = tails.get(key) ?? Promise.resolve()
  const run = prev.then(() => fn())
  // 清理回调仅在 run settle 后执行，此时 tail 已完成赋值，可安全自引用
  const tail: Promise<void> = run.then(
    () => {
      if (tails.get(key) === tail) tails.delete(key)
    },
    () => {
      if (tails.get(key) === tail) tails.delete(key)
    },
  )
  tails.set(key, tail)
  return run
}

// ---- 原子写（P0，todo 1.3.2）----

/**
 * 原子写：同目录写 `<file>.<pid>.<seq>.tmp` → 成功后 rename 覆盖目标。
 * - 半写状态不可见（读方要么读到旧文件、要么读到新文件）；
 * - Windows 下 Node rename 使用 MoveFileEx(REPLACE_EXISTING)，可覆盖已存在目标；libuv 打开句柄带
 *   FILE_SHARE_DELETE，读方持有文件时 rename 仍可成功（解决 EPERM/EBUSY 瞬时冲突）；
 * - 目标被短暂占用（宿主自身读 manifest、杀软扫描等不允许共享删除的打开）时 rename 会 EPERM/EBUSY，
 *   → 短暂重试若干次后再放弃（仍失败清理 tmp 并抛错，保持原有失败语义）。
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding,
): Promise<void> {
  const target = filePath
  try {
    await mkdir(dirname(target), { recursive: true })
  } catch (err) {
    throw new Error(`fs.write: mkdir '${dirname(target)}' for '${target}' failed: ${(err as Error).message}`)
  }
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${(seq++).toString(36)}.tmp`)
  await writeFile(tmp, data, encoding)
  let lastErr: unknown
  for (let i = 0; i < 4; i++) {
    try {
      await rename(tmp, target)
      return
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  await rm(tmp, { force: true }).catch(() => undefined)
  throw new Error(`fs.write: rename '${tmp}' -> '${target}' failed: ${(lastErr as Error)?.message ?? 'unknown'}`)
}

// ---- 跨进程锁原语（P1，todo 1.3.4）：fs.lock / fs.unlock / fs.withLock ----

export interface FileLockOptions {
  /** 锁自动过期毫秒（防持有方崩溃死锁），缺省 30s */
  ttlMs?: number
  /** 已被占用时是否排队等待；false 立即抛 busy，缺省 true */
  wait?: boolean
  /** 排队最大等待毫秒，超时抛 TIMEOUT，缺省 15s */
  timeoutMs?: number
}

interface LockRecord {
  lockId: string
  expiresAt: number
}

const pathLocks = new Map<string, LockRecord>()
const lockWaiters = new Map<string, Array<() => void>>()

function lockKey(filePath: string): string {
  return `lock:${normalizeKey(filePath)}`
}

function reapExpiredLocks(now: number): void {
  for (const [key, rec] of pathLocks) {
    if (rec.expiresAt <= now) pathLocks.delete(key)
  }
}

/** 等锁释放（notifyWaiters 唤醒）；仅通知一次，由调用方循环重查 */
function waitForFree(key: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // 超时回调内引用 entry：定时器异步触发，届时 entry 已定义
    const timer: NodeJS.Timeout = setTimeout(() => {
      const list = lockWaiters.get(key)
      if (list) {
        const i = list.indexOf(entry)
        if (i >= 0) list.splice(i, 1)
      }
      reject(new DlientError(DlientErrorCode.TIMEOUT, `[ERR -1004] fs.lock timeout: ${key}`))
    }, timeoutMs)
    const entry = () => {
      clearTimeout(timer)
      resolve()
    }
    const list = lockWaiters.get(key) ?? []
    list.push(entry)
    lockWaiters.set(key, list)
  })
}

function notifyWaiters(key: string): void {
  const list = lockWaiters.get(key)
  if (!list) return
  lockWaiters.delete(key)
  for (const fn of list) fn()
}

/**
 * 获取跨进程锁（按路径互斥；主进程内存锁表 + 落盘锁标记文件 `<path>.dlient-lock`）。
 * - 可重入判断：同路径再次 lock 视为排队（wait=false 时抛 busy）；
 * - ttl 自动过期，防持有方崩溃死锁；释放（unlock）后删除锁标记文件。
 * @returns { lockId } 释放锁时需回传
 */
export async function acquireLock(filePath: string, opts?: FileLockOptions): Promise<{ lockId: string }> {
  const { ttlMs = 30_000, wait = true, timeoutMs = 15_000 } = opts ?? {}
  const key = lockKey(filePath)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    reapExpiredLocks(Date.now())
    if (!pathLocks.has(key)) break
    if (!wait) {
      throw new DlientError(DlientErrorCode.USER_DENIED, `fs.lock busy: ${filePath}`)
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new DlientError(DlientErrorCode.TIMEOUT, `[ERR -1004] fs.lock timeout: ${filePath}`)
    }
    await waitForFree(key, Math.min(remaining, 1000))
  }
  const lockId = `${process.pid}.${(seq++).toString(36)}`
  const expiresAt = Date.now() + ttlMs
  pathLocks.set(key, { lockId, expiresAt })
  // 跨进程锁标记文件（约定：worker 直写 node:fs 前先检查/获取，见开发规范）；尽力而为，失败不阻塞持锁
  try {
    await atomicWriteFile(lockMarkerPath(filePath), JSON.stringify({ lockId, expiresAt }), 'utf-8')
  } catch {
    /* ignore */
  }
  return { lockId }
}

/** 释放锁（lockId 不匹配幂等忽略）；同时删除锁标记文件 */
export async function releaseLock(filePath: string, lockId: string): Promise<void> {
  const key = lockKey(filePath)
  const rec = pathLocks.get(key)
  if (rec && rec.lockId === lockId) {
    pathLocks.delete(key)
    notifyWaiters(key)
  }
  try {
    await rm(lockMarkerPath(filePath), { force: true }).catch(() => undefined)
  } catch {
    /* ignore */
  }
}

/** 锁标记文件路径（跨进程约定：绕过 host-api 直写 node:fs 的 worker 按此检查锁状态） */
export function lockMarkerPath(filePath: string): string {
  return `${filePath}.dlient-lock`
}
