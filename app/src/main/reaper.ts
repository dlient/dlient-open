/**
 * reaper.ts - 子进程收割进程的宿主侧管理（进程本体见 resources/reaper.mjs）。
 *
 * 设计（与 child-registry 的分层配合）：
 *  - **懒启动 + 常驻**：只有真的 spawn 了子进程才拉起；之后不再关闭，后续 spawn 仅经 stdin 写一行登记。
 *  - **宿主退出即收割**：reaper 与宿主之间只靠一根 stdin 管道；宿主进程结束（正常退出 / 崩溃 / 被强杀）
 *    该管道必然关闭 → reaper 读到 EOF → 按登记清单收割 → 自己退出。宿主无需显式销毁。
 *  - **启动兜底复用同一脚本**：L3（跨会话 pid 文件）不再由宿主自己解析进程快照，而是把残留记录喂给
 *    一次性 reaper 收割（同一套身份校验 + 后代兜底逻辑，单一实现）。
 *
 * 为什么用 `ELECTRON_RUN_AS_NODE=1 + process.execPath`：Electron 自带 Node，无需内置独立运行时、
 * 也不需要用户机器装 Node；且二进制就是应用自身（无额外签名/公证、无 AV 误报面）。该模式下不加载
 * 应用主脚本，因此不会触碰单实例锁。
 *
 * ⚠️ reaper 自身**不**经 hostSpawnChild / child-registry 登记：否则会被 will-quit 的 killAllChildren
 * 或下次启动的 L3 清扫误杀。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { logger } from '@dlient-open/core'

/** 跨会话残留记录（来自 <userData>/child-pids/<pid>.json） */
export interface StaleRecord {
  pid: number
  cmd?: string
  createdAt?: number
}

let resident: ChildProcess | null = null
let scriptPath: string | null | undefined

/** reaper 脚本路径：dev 取 <appRoot>/resources；打包后由 electron-builder extraResources 落到 <resources> */
function resolveScript(): string | null {
  if (scriptPath !== undefined) return scriptPath
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'reaper.mjs')]
    : [join(app.getAppPath(), 'resources', 'reaper.mjs')]
  scriptPath = candidates.find((p) => existsSync(p)) ?? null
  if (!scriptPath) {
    logger.warn('child', 'reaper script not found: leftover cleanup falls back to plain pid-tree kill')
  }
  return scriptPath
}

function reaperEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    // 收割结果与宿主主日志同目录，便于事后对账（reaper 无法回写 stdout）
    DLIENT_REAPER_LOG: join(app.getPath('userData'), 'logs', 'reaper.log'),
  }
}

function spawnReaper(script: string): ChildProcess | null {
  try {
    return spawn(process.execPath, [script], {
      env: reaperEnv(),
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    })
  } catch (err) {
    logger.warn('child', `reaper spawn failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** 懒启动并复用常驻 reaper（已常驻则直接返回） */
function ensureResident(): ChildProcess | null {
  if (resident && resident.exitCode === null && !resident.killed) return resident
  const script = resolveScript()
  if (!script) return null
  const child = spawnReaper(script)
  if (!child) return null
  child.on('error', (err) => {
    logger.warn('child', `reaper error: ${err instanceof Error ? err.message : String(err)}`)
    if (resident === child) resident = null
  })
  child.on('exit', (code) => {
    if (resident === child) resident = null
    logger.debug('child', `reaper exited code=${code ?? -1}`)
  })
  resident = child
  logger.debug('child', `reaper started pid=${child.pid ?? 0}`)
  return child
}

function send(line: string): void {
  const child = resident
  if (!child || !child.stdin || child.stdin.destroyed) return
  try {
    child.stdin.write(line)
  } catch {
    /* 管道已断（reaper 退出中）：下次登记会自动重新拉起 */
  }
}

/** 登记一个宿主 spawn 的子进程（首次调用会懒启动 reaper；createdAt 用于 PID 复用校验） */
export function trackChild(pid: number, cmd: string, createdAt = Date.now()): void {
  if (!Number.isFinite(pid) || pid <= 0) return
  if (!ensureResident()) return
  send(`R\t${pid}\t${createdAt}\t${basename(String(cmd ?? ''))}\n`)
}

/** 注销子进程（已被回收 / 杀掉） */
export function untrackChild(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return
  send(`U\t${pid}\n`)
}

/**
 * 宿主启动兜底：把上次会话残留的 pid 记录交给一次性 reaper 收割（收割完自行退出）。
 * 返回 true 表示已交给脚本（宿主不再自行处理）。
 */
export function reapStale(records: StaleRecord[]): boolean {
  if (records.length === 0) return false
  const script = resolveScript()
  if (!script) return false
  const child = spawnReaper(script)
  if (!child || !child.stdin) return false
  try {
    for (const r of records) {
      child.stdin.write(`R\t${r.pid}\t${r.createdAt ?? 0}\t${basename(String(r.cmd ?? ''))}\n`)
    }
    child.stdin.end()
  } catch {
    return false
  }
  child.on('exit', (code) => logger.info('child', `startup reaper exited code=${code ?? -1}`))
  logger.info('child', `startup reaper handed ${records.length} stale record(s)`)
  return true
}
