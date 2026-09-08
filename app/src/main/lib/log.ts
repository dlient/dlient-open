/**
 * lib/log.ts - 插件日志基础设施（方案 v2：日志推送/落盘/订阅/增量读取下沉 lib；bridge/api 引用）。
 * 提供：宿主写日志后的订阅推送（dev-tools 跨插件 + 渲染层本插件）、plugin-data/<id>/logs 落盘、
 * 增量 tail 读取、日志轮转、JSONL 格式化。
 * 装配：setHostRuntime 注入宿主 → 订阅者 worker 转发通道（plugin.logs.subscribe 用）；
 * 底部向 lib/plugin 注册 plugin 模块日志 host-api（readLogs/clearLogs/subscribe/unsubscribe）所需的适配器。
 */
import { app } from 'electron'
import { appendFile, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DlientError, DlientErrorCode } from '@dlient-open/core'
import { withFileLock } from '../file-queue'
import { registerPluginLogHooks, registerPluginRuntimeCall } from './plugin'

/** 装配时注入 runtime（宿主 → 订阅者 worker 转发日志用；避免与 runtime 循环依赖）
 * 并转发 lib/plugin.ts（plugin.logs.subscribe 宿主 → 订阅者 worker 推送通道）。 */
export function setHostRuntime(r: { callWorker(pluginId: string, method: string, args: unknown[]): Promise<unknown> }): void {
  registerPluginRuntimeCall(r ? (pluginId, method, args) => r.callWorker(pluginId, method, args) : null)
}

/** 插件日志订阅表：目标插件 id（含 @dev 实例键）→ subId → 通知回调（回调转发到订阅者 worker） */
const logSubscribers = new Map<string, Map<string, (line: string) => void>>()
let logSubSeq = 0

/** 日志写入后通知订阅者（无订阅者时零开销） */
function notifyLogSubscribers(pluginId: string, line: string): void {
  const set = logSubscribers.get(pluginId)
  if (!set || set.size === 0) return
  for (const notify of Array.from(set.values())) {
    try {
      notify(line)
    } catch {
      /* 单订阅者失败不影响其它 */
    }
  }
}

/** 渲染层 view 日志推送（bridge 注入：宿主日志写入 → 分发给订阅 'plugin-log' 的 view） */
let viewLogPush: ((pluginId: string, line: string) => void) | null = null
export function setViewLogPush(fn: (pluginId: string, line: string) => void): void {
  viewLogPush = fn
}

/** worker 侧日志落盘（fs.append / fs.withLock 'append' 到 plugin-data/<pluginId>/logs/）：
 * 只对「本插件 logs 目录」的追加触发，通知订阅者（dev-tools 跨插件通道）+ 渲染层视图推送（本插件实时）。 */
export function notifyLogWrite(pluginId: string, file: string, data: unknown): void {
  const line = data == null ? '' : String(data).replace(/\n+$/, '')
  if (!line) return
  if (!file.includes(join('plugin-data', pluginId, 'logs'))) return
  notifyLogSubscribers(pluginId, line)
  viewLogPush?.(pluginId, line)
}

/** 目标 id 白名单（与 plugin.dev.readLogs 一致）：只允许逻辑 id / dev 实例键，防路径穿越 */
function assertLogTarget(target: string): void {
  if (!/^[a-z0-9-]+(@dev)?$/.test(target)) {
    throw new DlientError(DlientErrorCode.INVALID, `invalid plugin id: ${target}`)
  }
}

/** 订阅插件日志：宿主在该插件日志写入处（appendPluginLog / fs.append 落盘）推送 line 给订阅者。
 * 返回 { subId }；取消经 plugin.logs.unsubscribe。 */
export function subscribePluginLog(
  target: string,
  onLine: (line: string) => void,
): { subId: string } {
  assertLogTarget(target)
  const subId = `log-${++logSubSeq}`
  let set = logSubscribers.get(target)
  if (!set) {
    set = new Map()
    logSubscribers.set(target, set)
  }
  set.set(subId, onLine)
  return { subId }
}

/** 取消订阅（subId 来自 subscribePluginLog / plugin.logs.subscribe）。F11：Set 空则回收外层 key */
export function unsubscribePluginLog(target: string, subId: string): boolean {
  const set = logSubscribers.get(target)
  if (!set) return false
  const deleted = set.delete(subId)
  if (deleted && set.size === 0) logSubscribers.delete(target)
  return deleted
}

/** 插件退出/卸载时清空其全部日志订阅（防死回调引用滞留，配合 dev 热重载；F11） */
export function clearLogSubscribersFor(pluginId: string): void {
  logSubscribers.delete(pluginId)
}

/** 插件日志大小轮转阈值（与宿主 logger 一致：≥5MB 滚动，保留 main.log + .1 + .2） */
const PLUGIN_LOG_ROTATE_LIMIT = 5 * 1024 * 1024

/** 日志轮转（持锁调用方保证串行）：main.log → .1 → .2，删除超出的 .2（lib/fs.ts runLockedOp 'rotate' 亦用） */
export async function rotateLogFiles(file: string): Promise<void> {
  const shift = (n: number): Promise<void> =>
    (async () => {
      const from = n === 0 ? file : `${file}.${n}`
      const to = `${file}.${n + 1}`
      try {
        await rm(to, { force: true })
      } catch { /* 不存在忽略 */ }
      try {
        await rename(from, to)
      } catch { /* 源不存在忽略 */ }
    })()
  // 先滚动 .1 → .2，再 main.log → .1（顺序保证无覆盖丢失）
  await shift(1)
  await shift(0)
}

/** 插件日志 JSONL 结构键：由本函数独占，data 展开时不得覆盖（防插件 source 等污染日志来源） */
const RESERVED_LOG_KEYS = new Set(['ts', 'level', 'source', 'msg'])

/**
 * 构造插件日志 JSONL 行：{"ts","level","source","msg", ...data 展开}；
 * 与 log.write（log host-api，worker/rpc 与 renderer/api 两侧）格式一致，可程序化分析。
 * 防注入：换行/控制字符清除（保逐行结构），超长截断。
 * 注意：data 展开跳过 ts/level/source/msg 结构键 —— source 恒为日志来源（host/worker/renderer），
 * 插件/诊断数据里的同名键不会覆盖（如插件的 market/local/dev 来源应放 pluginSource 等非保留键）。
 */
export function formatPluginLogLine(level: string, source: string, message: string, data?: unknown): string {
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.${String(ts.getMilliseconds()).padStart(3, '0')}`
  const sanitize = (v: string) => v.replace(/[\r\n\0]/g, ' ').slice(0, 8 * 1024)
  const entry: Record<string, unknown> = { ts: time, level, source, msg: sanitize(String(message ?? '')) }
  if (data !== undefined) {
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      for (const [k, v] of Object.entries(data)) {
        if (RESERVED_LOG_KEYS.has(k)) continue
        entry[k] = v
      }
    } else {
      entry.data = data
    }
  }
  try {
    return JSON.stringify(entry)
  } catch {
    entry.data = sanitize(String(data))
    return JSON.stringify(entry)
  }
}

/** 插件日志增量读取：半行缓存（按 pluginId；offset 由渲染层传回，主进程只记未完成的残段） */
const pluginLogTails = new Map<string, string>()

/**
 * 读取插件自有日志（todo 7.2.9，增量 tail 模式，见 docs/todo/07-logging.md §7.3.10）。
 *
 * 渲染层传「已消费字节 offset」，主进程只回传其后的**完整 JSONL 行**，避免每次全量读+解析；
 * 半行缓存/轮转检测/截尾边界全部在主进程收敛。持 main.log 锁与写入/轮转串行。
 *
 * @param options.offset 已消费字节数（首帧 0）；轮转/超大增量时自动 reset
 * @param options.maxBytes 单次返回字节上限（截尾起点取完整行边界；缺省 512KB）
 * @returns lines（完整行数组，已切好行）、offset（下次续读起点=本次读到的文件大小）、
 *          reset（轮转/增量超限 → 渲染层应清空列表重来）、truncated（首帧/重置时超限截尾）
 */
export async function readPluginLogs(
  pluginId: string,
  options: { offset?: number; maxBytes?: number } = {},
): Promise<{ lines: string[]; offset: number; reset: boolean; truncated: boolean }> {
  const maxBytes = Number.isFinite(options.maxBytes) && (options.maxBytes ?? 0) > 0 ? (options.maxBytes as number) : 512 * 1024
  const logsDir = join(app.getPath('userData'), 'plugin-data', pluginId, 'logs')
  const mainFile = join(logsDir, 'main.log')

  return withFileLock(mainFile, async () => {
    let size = 0
    try {
      size = (await stat(mainFile)).size
    } catch { /* 首次写入前的空文件 */ }
    const offset = Number.isFinite(options.offset) && (options.offset ?? 0) > 0 ? Math.floor(options.offset as number) : 0
    let tail = pluginLogTails.get(pluginId) ?? ''

    // 模式判定：首次 / 轮转（offset 超前于当前 size，文件被滚动重建） / 单次增量超限 → 截尾重来
    let reset = false
    let start: number
    if (offset <= 0 || offset > size || size - offset > maxBytes) {
      reset = true
      tail = ''
      start = Math.max(0, size - maxBytes)
    } else {
      start = offset
    }

    const raw = start < size ? await readFileRange(mainFile, start, size) : ''
    // 截尾起点可能切开半行：丢弃不完整首行（从下一个 '\n' 后开始），保证 lines 从完整行边界起
    let body = raw
    if (reset && start > 0) {
      const nl = raw.indexOf('\n')
      body = nl === -1 ? '' : raw.slice(nl + 1)
    } else if (!reset && tail) {
      body = tail + raw
    }

    // 按 '\n' 切行：完整行返回；末尾无换行的残段缓存，待下次拼接
    const lines: string[] = []
    for (;;) {
      const nl = body.indexOf('\n')
      if (nl === -1) break
      lines.push(body.slice(0, nl))
      body = body.slice(nl + 1)
    }
    pluginLogTails.set(pluginId, body)

    return { lines, offset: size, reset, truncated: reset && size > maxBytes }
  })
}

/** 读取文件 [start, end) 区间文本；文件不存在/越界返回空串 */
async function readFileRange(file: string, start: number, end: number): Promise<string> {
  try {
    const handle = await open(file, 'r')
    try {
      const len = end - start
      const buf = Buffer.alloc(len)
      const { bytesRead } = await handle.read(buf, 0, len, start)
      return buf.subarray(0, bytesRead).toString('utf-8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/** 追加插件日志行（todo 任务 7.2.8）：写 `plugin-data/<pluginId>/logs/main.log`，
 * 由 bridge 用视图登记身份定位目录（渲染层不可自报），与 worker `fs.append` 同文件经 withFileLock 互斥。
 */
export async function appendPluginLog(pluginId: string, line: string): Promise<void> {
  const logsDir = join(app.getPath('userData'), 'plugin-data', pluginId, 'logs')
  const file = join(logsDir, 'main.log')
  await withFileLock(file, async () => {
    try {
      await mkdir(logsDir, { recursive: true })
    } catch { /* 已存在忽略 */ }
    try {
      if ((await stat(file)).size >= PLUGIN_LOG_ROTATE_LIMIT) await rotateLogFiles(file)
    } catch { /* 文件不存在（首次写入）跳过轮转 */ }
    await appendFile(file, line + '\n')
  })
  // 落盘后按订阅推送（取代轮询/文件 watcher：订阅者渲染层直接 append）
  notifyLogSubscribers(pluginId, line)
  // 渲染层 view 推送：订阅本插件 'plugin-log' 事件的视图直接追加（无 plugin.dev 权限要求，只收自己）
  viewLogPush?.(pluginId, line)
}

/** 清空插件自有日志（渲染层 LogViewer 删除图标用；view 身份由 bridge 推导，只清自己） */
export async function clearPluginLog(pluginId: string): Promise<void> {
  pluginLogTails.delete(pluginId)
  const mainFile = join(app.getPath('userData'), 'plugin-data', pluginId, 'logs', 'main.log')
  await rm(mainFile, { force: true })
}

// lib/plugin.ts 日志类 host-api（plugin.dev.readLogs/clearLogs、plugin.logs.subscribe/unsubscribe）
// 适配宿主日志推送基础设施（订阅表 + 半行缓存同源）。
// 注意：不能在此处模块顶层调用 —— log.ts 与 plugin.ts 存在（经 child 等的）循环依赖，
// 打包后此处顶层调用会先于 plugin.ts 的 `let logHooks` 初始化（TDZ）。改为由装配处显式调用。
export function initPluginLogHooks(): void {
  registerPluginLogHooks({
    subscribe: (target, onLine) => subscribePluginLog(target, onLine),
    unsubscribe: (target, subId) => unsubscribePluginLog(target, subId),
    read: (target, options) => readPluginLogs(target, options),
    clearTail: (target) => {
      pluginLogTails.delete(target)
    },
  })
}
