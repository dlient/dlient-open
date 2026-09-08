/**
 * api/fs.ts - fs 模块 host-api（元数据 + handler；复杂实现经 lib/fs.ts 与宿主辅助）。
 * fs 资源白名单强制校验由 executeHostApi 统一（lib/grants.ts FS_PATH_MODE + assertPathAllowed）。
 */
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { watch as fsWatch } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { app } from 'electron'
import { DlientError, DlientErrorCode, logger } from '@dlient-open/core'
import type { ApiDefinition } from './types'
import { acquireLock, releaseLock, type FileLockOptions } from '../file-queue'
import { appendFileLocked, copyDirRecursive, deleteFileLocked, fileWatchers, isAsarFileBody, readFileBufferLocked, readFileLocked, runLockedOp, statFileLocked, withoutAsar, writeFileLocked } from '../lib/fs'
import { notifyLogWrite } from '../lib/log'

/** fs.watch 监听 id 序号（api 模块本地） */
let watchSeq = 0

/** 路径参数校验：缺参 / 非字符串 / 空串 → INVALID（避免 undefined 被拼进真实路径产生误导性 ENOENT） */
function requirePath(v: unknown, method: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new DlientError(DlientErrorCode.INVALID, `${method}: path required (string)`)
  }
  return v
}

/** 出错时把目标路径拼进错误消息（mkdir/rename EPERM 等原始错误通常只带父目录，难以定位真实文件） */
async function annotatePath<T>(file: string, tag: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${tag} '${file}': ${msg}`)
  }
}

/** 诊断：宿主对 .asar 文件本体操作后自检是否已产生锁（本进程持归档句柄则 rename 失败）。
 *  仅用于定位「上传/打包后 plugin.asar 被宿主锁到进程退出」问题；成功无锁打 info，失败打 warn。 */
async function selfProbeAsarLock(file: string, tag: string): Promise<void> {
  if (!/\.asar$/i.test(file)) return
  const probe = `${file}.selftest`
  try {
    await rm(probe, { force: true })
    await rename(file, probe)
    await rename(probe, file)
    logger.info('fs', `[fslock] ${tag} ok`, { file })
  } catch (err) {
    logger.warn('fs', `[fslock] ${tag} ASAR_LOCKED`, {
      file,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export const fsApis: ApiDefinition[] = [
  {
    key: 'fs.read',
    description: { 'zh-CN': '读取文件（文本或 base64）', 'en-US': 'Read file (text or base64)' },
    scope: 'all',
    level: 'warn',
    handler: async ([path, opts]) => {
      const file = requirePath(path, 'fs.read')
      const o = (typeof opts === 'object' && opts !== null ? opts : {}) as { base64?: unknown }
      if (o.base64 === true) {
        const buf = await readFileBufferLocked(file)
        await selfProbeAsarLock(file, 'read')
        return buf.toString('base64')
      }
      const text = await readFileLocked(file)
      await selfProbeAsarLock(file, 'read')
      return text
    },
  },
  {
    key: 'fs.stat',
    description: { 'zh-CN': '文件/目录状态', 'en-US': 'File/dir stat' },
    scope: 'all',
    level: 'warn',
    handler: async ([path]) => {
      const s = await statFileLocked(String(path))
      await selfProbeAsarLock(String(path), 'stat')
      return s
    },
  },
  {
    key: 'fs.listDir',
    description: { 'zh-CN': '枚举目录条目', 'en-US': 'List directory entries' },
    scope: 'all',
    level: 'warn',
    handler: async ([path]) => {
      const dir = String(path)
      const entries = await readdir(dir, { withFileTypes: true })
      return Promise.all(
        entries.map(async (e) => {
          const p = join(dir, e.name)
          let size = 0
          let mtimeMs = 0
          if (e.isFile() || e.isDirectory()) {
            try {
              // .asar 文件本体：Electron asar 补丁会把 stat 归档化并保持句柄（锁文件到进程退出），
              // 用原生 fs 真实 stat；inner 访问（plugin.asar\<entry>）不受影响。
              const s = isAsarFileBody(p) ? await withoutAsar(() => stat(p)) : await stat(p)
              size = s.size
              mtimeMs = s.mtimeMs
              if (e.isFile()) await selfProbeAsarLock(p, 'listdir-stat')
            } catch {
              /* stat 失败（权限/竞态）按 0 处理 */
            }
          }
          return { name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile(), size, mtimeMs }
        }),
      )
    },
  },
  {
    key: 'fs.probeLocked',
    description: { 'zh-CN': '探测文件是否被进程锁定（禁止改名/删除）', 'en-US': 'Probe whether file is locked (rename/delete blocked)' },
    scope: 'all',
    level: 'warn',
    handler: async ([path]) => {
      const file = requirePath(path, 'fs.probeLocked')
      const probe = `${file}.lockprobe`
      try {
        await rm(probe, { force: true })
        await rename(file, probe)
        await rename(probe, file)
        return false
      } catch {
        await rm(probe, { force: true }).catch(() => undefined)
        return true
      }
    },
  },
  {
    key: 'fs.watch',
    description: { 'zh-CN': '监听目录变更', 'en-US': 'Watch directory changes' },
    scope: 'all',
    level: 'warn',
    handler: async ([path], ctx) => {
      const dir = String(path)
      const pluginId = ctx.pluginId
      const watchId = `watch-${++watchSeq}`
      const watcher = fsWatch(dir, { persistent: false }, (_event, filename) => {
        const rec = fileWatchers.get(watchId)
        if (!rec) return
        void rec.invoke(rec.pluginId, rec.pluginId, `${rec.pluginId}.fs-watch-event`, [watchId, String(filename ?? '')]).catch(() => {
          /* 目标 worker 未运行 / 未暴露：忽略 */
        })
      })
      watcher.on('error', () => {
        /* 监听错误（目录被删等）：静默，交由 worker 侧 fallback 刷新 */
      })
      fileWatchers.set(watchId, { watcher, pluginId, invoke: ctx.invokePlugin })
      return watchId
    },
  },
  {
    key: 'fs.unwatch',
    description: { 'zh-CN': '停止目录监听', 'en-US': 'Stop watching directory' },
    scope: 'all',
    level: 'warn',
    handler: async ([watchId]) => {
      const rec = fileWatchers.get(String(watchId))
      if (!rec) return undefined
      fileWatchers.delete(String(watchId))
      try {
        rec.watcher.close()
      } catch {
        /* 已关闭忽略 */
      }
      return undefined
    },
  },
  {
    key: 'fs.mkdir',
    description: { 'zh-CN': '创建目录', 'en-US': 'Create directory' },
    scope: 'all',
    level: 'dangerous',
    handler: async ([path]) => {
      const file = requirePath(path, 'fs.mkdir')
      await annotatePath(file, 'fs.mkdir', () => mkdir(file, { recursive: true }))
    },
  },
  {
    key: 'fs.write',
    description: { 'zh-CN': '写文件', 'en-US': 'Write file' },
    scope: 'all',
    level: 'dangerous',
    handler: async ([path, data]) => {
      const file = requirePath(path, 'fs.write')
      await annotatePath(file, 'fs.write', () => writeFileLocked(file, data))
    },
  },
  {
    key: 'fs.append',
    description: { 'zh-CN': '追加写文件', 'en-US': 'Append to file' },
    scope: 'all',
    level: 'dangerous',
    handler: async ([path, data], ctx) => {
      const file = String(path)
      await mkdir(dirname(file), { recursive: true })
      await annotatePath(file, 'fs.append', () => appendFileLocked(file, data == null ? '' : String(data)))
      // 写入插件日志（log.write host-api 走此落盘；plugin-data/<自身>/logs/main.log）
      // → 通知订阅者 + 渲染层视图推送（LogViewer 默认订阅实时追加）
      notifyLogWrite(String(ctx.pluginId ?? ''), file, data)
      return undefined
    },
  },
  {
    key: 'fs.delete',
    description: { 'zh-CN': '删除文件/目录', 'en-US': 'Delete file/dir' },
    scope: 'all',
    level: 'dangerous',
    handler: async ([path]) => {
      const file = String(path)
      await annotatePath(file, 'fs.delete', () => deleteFileLocked(file))
    },
  },
  {
    key: 'fs.copyDir',
    description: { 'zh-CN': '复制目录（限 userData 内）', 'en-US': 'Copy directory (inside userData)' },
    scope: 'all',
    level: 'dangerous',
    handler: async ([src, dest, exclude]) => {
      const from = String(src ?? '')
      const to = String(dest ?? '')
      if (!from || !to) throw new DlientError(DlientErrorCode.INVALID, 'fs.copyDir: src/dest required')
      // 安全：目标必须落在 USER_DATA 内（防 worker 写系统目录）；源不限（与 fs.read 权限相当）
      const userData = normalize(app.getPath('userData'))
      const normalizedDest = normalize(to)
      if (normalizedDest !== userData && !normalizedDest.startsWith(userData + sep)) {
        throw new DlientError(DlientErrorCode.INVALID, 'fs.copyDir: dest must be inside userData')
      }
      const excludes = Array.isArray(exclude) ? exclude.map((e) => String(e)) : []
      await annotatePath(`${from} -> ${normalizedDest}`, 'fs.copyDir', async () => {
        // 先物理清空目标（noAsar：防目录内残留 plugin.asar 被补丁 rm/unlink 拦截删不掉）
        await withoutAsar(() => rm(normalizedDest, { recursive: true, force: true }))
        await copyDirRecursive(from, normalizedDest, new Set(excludes))
      })
      return undefined
    },
  },
  {
    key: 'fs.lock',
    description: { 'zh-CN': '获取跨进程文件锁', 'en-US': 'Acquire file lock' },
    scope: 'worker',
    level: 'warn',
    handler: async ([path, opts]) => acquireLock(String(path), opts as FileLockOptions | undefined),
  },
  {
    key: 'fs.unlock',
    description: { 'zh-CN': '释放文件锁', 'en-US': 'Release file lock' },
    scope: 'worker',
    level: 'warn',
    handler: async ([path, lockId]) => {
      await releaseLock(requirePath(path, 'fs.unlock'), String(lockId ?? ''))
      return undefined
    },
  },
  {
    key: 'fs.withLock',
    description: { 'zh-CN': '持锁执行文件操作', 'en-US': 'Run file op under lock' },
    scope: 'worker',
    level: 'warn',
    handler: async ([path, op, opts], ctx) => {
      const file = requirePath(path, 'fs.withLock')
      const { lockId } = await acquireLock(file, opts as FileLockOptions | undefined)
      try {
        const result = await runLockedOp(file, op)
        // worker 日志落盘（fs.withLock 'append' 到 plugin-data/<自身>/logs/main.log）
        // → 通知订阅者 + 渲染层视图推送（LogViewer 默认订阅实时追加）
        const o = (typeof op === 'object' && op !== null ? op : {}) as { method?: string; data?: unknown }
        if (o.method === 'append') {
          notifyLogWrite(String(ctx.pluginId ?? ''), file, o.data)
        }
        return result
      } finally {
        await releaseLock(file, lockId)
      }
    },
  },
]
