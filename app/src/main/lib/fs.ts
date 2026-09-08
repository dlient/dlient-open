/**
 * lib/fs.ts - fs 文件系统复杂实现（方案 v2：文件/目录操作、fs.withLock 执行器、fs.watch 注册表下沉）。
 * 文件操作统一 per-path 串行锁 + 原子写（file-queue.ts）；日志轮转复用 lib/log.ts rotateLogFiles。
 */
import type { FSWatcher } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DlientError, DlientErrorCode } from '@dlient-open/core'
import { atomicWriteFile, withFileLock } from '../file-queue'
import { rotateLogFiles } from './log'

/** Electron 内置 original-fs：未打 asar 补丁的原始 fs。读 .asar 文件本体必须走它——asar 补丁
 *  （含 process.noAsar=false 下的 promises readFile）会把 .asar 本体当归档打开并保持句柄
 *  （Windows 文件锁到进程退出）。inner 路径（plugin.asar\<entry>）仍走补丁语义，不受影响。 */
const nodeRequire = createRequire(import.meta.url)
const originalFs = nodeRequire('original-fs') as typeof import('node:fs')
const originalFsPromises = originalFs.promises as typeof import('node:fs/promises')

/** 路径是否「以 .asar 结尾的文件本体」（Electron asar 补丁会把这类路径当归档去解析 inner，
 *  对文件本体的读写/stat 需临时关闭 asar 支持，否则抛 "ENOENT, not found in X.asar"） */
export function isAsarFileBody(file: string): boolean {
  return /\.asar$/i.test(file)
}

/** 临时关闭 Electron asar 补丁执行 fn（读 .asar 文件本体用；inner 路径 '.asar\<entry>' 不受影响） */
export function withoutAsar<T>(fn: () => Promise<T>): Promise<T> {
  const proc = process as unknown as { noAsar?: boolean }
  const prev = proc.noAsar
  proc.noAsar = true
  try {
    return fn().finally(() => {
      proc.noAsar = prev
    })
  } catch (err) {
    proc.noAsar = prev
    throw err
  }
}

/** 同步 withoutAsar（Electron asar 补丁会对 .asar 本体的 stat/existsSync 也归档化并保持句柄） */
export function withoutAsarSync<T>(fn: () => T): T {
  const proc = process as unknown as { noAsar?: boolean }
  const prev = proc.noAsar
  proc.noAsar = true
  try {
    return fn()
  } finally {
    proc.noAsar = prev
  }
}

/** 读文本（per-path 锁）；.asar 本体经 original-fs（未打补丁）读真实归档字节 */
export async function readFileLocked(file: string): Promise<string> {
  return withFileLock(file, () =>
    isAsarFileBody(file) ? originalFsPromises.readFile(file, 'utf-8') : readFile(file, 'utf-8'),
  )
}

/** 原始字节读取（fs.read base64 场景：插件读二进制资源，IPC 只能传文本）；.asar 本体同上 */
export async function readFileBufferLocked(file: string): Promise<Buffer> {
  return withFileLock(file, () =>
    isAsarFileBody(file) ? originalFsPromises.readFile(file) : readFile(file),
  )
}

/** 写文件（原子写；data 支持 { base64 } 二进制） */
export async function writeFileLocked(file: string, data: unknown): Promise<void> {
  return withFileLock(file, () => {
    if (typeof data === 'object' && data !== null && typeof (data as { base64?: unknown }).base64 === 'string') {
      return atomicWriteFile(file, Buffer.from((data as { base64: string }).base64, 'base64'))
    }
    return atomicWriteFile(file, String(data), 'utf-8')
  })
}

/** 删除文件/目录。递归删除时临时关闭 asar 补丁：目录内残留的历史 plugin.asar 若经补丁 unlink/rm
 *  会被当归档成员处理而删不掉（EMFILE/ENOENT/EPERM），noAsar 下 rm 一律按真实文件物理删除。 */
export async function deleteFileLocked(file: string): Promise<void> {
  return withFileLock(file, () => withoutAsar(() => rm(file, { recursive: true, force: true })))
}

/** stat（per-path 锁）；.asar 本体经 original-fs（未打补丁，防归档化 size=0 伪 stat） */
export async function statFileLocked(file: string): Promise<unknown> {
  return withFileLock(file, () =>
    isAsarFileBody(file) ? originalFsPromises.stat(file) : stat(file),
  )
}

/** 追加写（插件日志/追加数据用） */
export async function appendFileLocked(file: string, data: string | Buffer): Promise<void> {
  return withFileLock(file, () => appendFile(file, data))
}

/** 递归拷贝目录（fs.copyDir 用）：跳过 exclude 顶层段（如 node_modules/.git/src/script） */
export async function copyDirRecursive(src: string, dest: string, exclude: Set<string>): Promise<void> {
  await mkdir(dest, { recursive: true })
  for (const ent of await readdir(src, { withFileTypes: true })) {
    if (exclude.has(ent.name)) continue
    const s = join(src, ent.name)
    const d = join(dest, ent.name)
    if (ent.isDirectory()) await copyDirRecursive(s, d, exclude)
    // .asar 结尾文件本体经 original-fs 拷贝：补丁 fs 会把名为 plugin.asar 的普通文件当归档解析
    // （报 ENOENT "not found in X.asar"），统一按原生文件复制（no-asar 打包下这类文件只是普通产物/残留）
    else if (isAsarFileBody(d)) await originalFsPromises.copyFile(s, d)
    else await copyFile(s, d)
  }
}

/** fs.withLock 在持锁期间执行的单次文件操作（op.method 见 api/fs.ts host-api 定义） */
export async function runLockedOp(file: string, op: unknown): Promise<unknown> {
  const o = (typeof op === 'object' && op !== null ? op : {}) as { method?: string; data?: unknown }
  switch (o.method) {
    case 'read':
      return readFileLocked(file)
    case 'write':
      await writeFileLocked(file, o.data)
      return undefined
    case 'delete':
      await deleteFileLocked(file)
      return undefined
    case 'stat':
      return statFileLocked(file)
    case 'append':
      await appendFileLocked(file, o.data == null ? '' : String(o.data))
      return undefined
    case 'rotate':
      // 日志轮转（宿主 lib/log.ts 写插件日志 / log.write 落盘前的 5MB 惰性检查滚动；runLockedOp 已在锁内，直接执行）
      await rotateLogFiles(file)
      return undefined
    default:
      throw new DlientError(DlientErrorCode.INVALID, `fs.withLock invalid op.method: ${String(o.method)}`)
  }
}

// fs.watch 监听注册表（watchId → 监听器 + 归属插件）：变更时回调归属插件自身 worker。
// 插件卸载/宿主退出时不强制关闭（Node fs.watch 非 persistent，进程退出自然回收）。
export interface FileWatcherRecord {
  watcher: FSWatcher
  pluginId: string
  invoke: (fromPluginId: string, targetPluginId: string, method: string, args: unknown[]) => Promise<unknown>
}
export const fileWatchers = new Map<string, FileWatcherRecord>()
