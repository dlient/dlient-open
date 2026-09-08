/**
 * logger.ts - 宿主统一日志模块（零第三方依赖；todo 任务 7.2.1）。
 *
 * 解决：主进程 / worker（rpc.log / stdout）/ 渲染层四链路此前各自 console.*，
 * 格式不一、无时间戳、无落盘。本模块提供：
 *  - 级别控制（debug < info < warn < error，DLIENT_LOG_LEVEL 或 config）；
 *  - 统一格式 `[yyyy-MM-dd HH:mm:ss.SSS][级别][来源] message {json}`；
 *  - 双通道：console（终端）+ 文件（userData/logs/main.log，追加流）；
 *  - 轮转：启动时检查大小（≥5MB）→ .1/.2 滚动，保留 3 份；
 *  - 审计开关（host-api 审计日志复用，todo 7.2.4）。
 *
 * 仅主进程使用（core 只在主进程运行）；插件 worker / 渲染层各自的插件日志
 * 经专属 log host-api（log.write，见 api/log.ts）写入，无需在此封装。
 */

import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { getErrorCode } from './errors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** 来源白名单前缀（防插件注入伪造来源混淆日志） */
const SOURCE_PREFIXES = ['main', 'bridge', 'protocol', 'runtime', 'pool:', 'plugin:', 'renderer', 'audit', 'child', 'lifecycle']

const ROTATE_LIMIT = 5 * 1024 * 1024 // 5MB
const KEEP_FILES = 3 // main.log + .1 + .2

class Logger {
  private level: LogLevel = 'info'
  private auditEnabled = false
  private logsDir: string | null = null
  private stream: WriteStream | null = null
  private initErrorLogged = false

  /** 初始化（app ready 后由 index.ts 调用）：建目录 + 轮转 + 打开文件流 */
  init(): void {
    try {
      if (!app.isReady()) return
      this.logsDir = join(app.getPath('userData'), 'logs')
      mkdirSync(this.logsDir, { recursive: true })
      this.rotate()
      this.stream = createWriteStream(join(this.logsDir, 'main.log'), { flags: 'a', encoding: 'utf-8' })
      this.stream.on('error', () => {
        /* 写失败降级 console：不阻塞业务 */
      })
    } catch (err) {
      this.logsDir = null
      this.stream = null
      if (!this.initErrorLogged) {
        this.initErrorLogged = true
        console.error('[logger] init failed (fallback to console only):', err)
      }
    }
  }

  /** 日志目录（诊断导出用）；未初始化返回 null */
  dir(): string | null {
    return this.logsDir
  }

  /** 启动轮转：main.log → .1 → .2，删除 .2，保留 3 份 */
  private rotate(): void {
    if (!this.logsDir) return
    const file = (n: number) => (n === 0 ? 'main.log' : `main.log.${n}`)
    const size = (n: number) => {
      try {
        return statSync(join(this.logsDir!, file(n))).size
      } catch {
        return 0
      }
    }
    if (size(0) < ROTATE_LIMIT) return
    for (let n = KEEP_FILES - 2; n >= 0; n--) {
      const from = join(this.logsDir, file(n))
      const to = join(this.logsDir, file(n + 1))
      if (!existsSync(from)) continue
      if (existsSync(to)) renameSync(to, `${to}.old`) // 目标已存在先挪开，Windows rename 不覆盖目录语义兼容
      try {
        renameSync(from, to)
      } finally {
        try { renameSync(`${to}.old`, to) } catch { /* .old 不存在忽略 */ }
      }
    }
  }

  setLevel(level: LogLevel): void {
    if (LEVEL_ORDER[level] !== undefined) this.level = level
  }

  audit(enabled: boolean): void {
    this.auditEnabled = enabled
  }

  isAuditEnabled(): boolean {
    return this.auditEnabled
  }

  /** 全量入口 */
  log(level: LogLevel, source: string, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return
    if (typeof message !== 'string') message = String(message ?? '')
    if (!SOURCE_PREFIXES.some((p) => source.startsWith(p))) source = 'main'
    const line = formatLine(level, source, message, data)
    emitConsole(level, line)
    this.stream?.write(line + '\n')
  }

  debug(source: string, message: string, data?: unknown): void {
    this.log('debug', source, message, data)
  }
  info(source: string, message: string, data?: unknown): void {
    this.log('info', source, message, data)
  }
  warn(source: string, message: string, data?: unknown): void {
    this.log('warn', source, message, data)
  }
  error(source: string, message: string, data?: unknown): void {
    this.log('error', source, message, data)
  }
}

function formatLine(level: LogLevel, source: string, message: string, data?: unknown): string {
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.${String(ts.getMilliseconds()).padStart(3, '0')}`
  let json = ''
  if (data !== undefined) {
    try {
      json = ' ' + JSON.stringify(data)
    } catch {
      json = ' ' + String(data)
    }
  }
  return `[${time}][${level.toUpperCase()}][${source}] ${message}${json}`
}

function emitConsole(level: LogLevel, line: string): void {
  switch (level) {
    case 'error': console.error(line); break
    case 'warn': console.warn(line); break
    case 'debug': console.debug(line); break
    default: console.log(line)
  }
}

export const logger = new Logger()

/** 便捷：把任意 Error 归一为可记录的对象（错误码体系；todo 7.2.4 审计用） */
export function errorDetail(err: unknown): { message: string; code: number } {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return { message, code: getErrorCode(err) }
}

// 便捷导出（供 import { log } 风格使用）
export const log = logger.log.bind(logger)
export const debug = logger.debug.bind(logger)
export const info = logger.info.bind(logger)
export const warn = logger.warn.bind(logger)
export const error = logger.error.bind(logger)
