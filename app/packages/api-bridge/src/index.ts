/**
 * @dlient-open/api-bridge - 渲染进程「插件实例 API」共享桥。
 *
 * 这是插件与宿主之间唯一需要共享实例的模块：PluginApiContext + useDlientApi。
 * 必须作为 SystemJS 共享模块（singleton）由宿主注册，否则插件的 useDlientApi 读到的是
 * 插件自己打包的一份 Context，读不到宿主 PluginView 注入的值。
 *
 * 注意：本包必须保持极简 —— 只依赖 react 的命名导出（createContext/useContext），
 * 不允许引入 JSX / 其它 CJS 依赖（宿主经 SystemJS registry 以单实例提供，避免被打包进插件产物）。
 */

import { createContext, useContext } from 'react'

// 单源类型（@dlient-open/api-types）：UiHostApi 各方法签名取自 HostApiMap；通知 options/事件 payload
// 与主进程/worker（@dlient-open/plugin-sdk）共享同一定义（同 host-api.ts 迁移），本地不再重复。
import type { HostApiMap, NotificationSendOptions, NotificationHandle } from '@dlient-open/api-types'
export type { NotificationSendOptions, NotificationEventPayload, NotificationHandle } from '@dlient-open/api-types'

/**
 * 统一调用错误码（内联，真源 @dlient-open/core errors.ts —— 改动须同步）。
 * 渲染层插件经 `getErrorCode(err)` / `err.code` 程序化区分调用错误；
 * 主进程 / worker 侧错误经协议透传，message 均带 `[ERR -xxxx]` 前缀兜底。
 */
export const DlientErrorCode = {
  OK: 0,

  // ---- 调用授权 / 编排（兼容历史 CALL_ERR）----
  NOT_INSTALLED: -1001,
  INSTALL_FAILED: -1002,
  USER_DENIED: -1003,
  TIMEOUT: -1004,
  INVALID: -1005,
  DIALOG_CANCELED: -1006,

  // ---- 调用前校验（PluginManager.canInvoke）----
  TARGET_NOT_FOUND: -2001,
  METHOD_NOT_EXPOSED: -2002,
  NEED_RUNTIME_CONFIRM: -2003,
  NEED_INSTALL_CONFIRM: -2004,
  ACCESS_DENIED: -2005,

  // ---- 执行 / 传输层 ----
  METHOD_NOT_REGISTERED: -2101,
  WORKER_NOT_RUNNING: -2102,
  PORT_NOT_READY: -2103,
  INVALID_SIGNATURE: -2104,
  VIEW_NOT_REGISTERED: -2105,
  HOST_API_NOT_FOUND: -2106,
  PERMISSION_DENIED: -2107,

  // ---- 兜底 ----
  INTERNAL: -2200,
  /** 插件 handler 内部未捕获异常（SDK 兜底包装为信封，列入公共表）；from 指向插件 ID */
  THROW_ERROR: -2201,
} as const

export type DlientErrorCode = (typeof DlientErrorCode)[keyof typeof DlientErrorCode]

/** 统一响应信封：所有请求（含流式）返回 { code, msg, data, from } */
export type ResponseErrorMsg = string | { enUS: string; zhCN: string }

export interface ApiResponse<T = unknown> {
  /** 错误码：0 为成功；负数为错误。宿主错误 from=''，插件错误 from=插件 ID */
  code: number
  /** 错误说明（可为多语言对象，UI 端可直接显示） */
  msg?: ResponseErrorMsg
  /** 业务数据：失败时通常为 null */
  data?: T
  /** 来源：'' 宿主侧；其他为插件 ID */
  from: string
}

/** 从错误 message 解析 `[ERR -xxxx]` 前缀（跨 contextBridge 丢字段时的兜底） */
export function parseErrCodeFromMessage(message: string): DlientErrorCode | undefined {
  const m = /\[ERR\s*(-?\d+)\]/.exec(message ?? '')
  if (m && m[1] !== undefined) return Number(m[1]) as DlientErrorCode
  return undefined
}

/** 从任意错误提取错误码：优先 code 字段，其次 message `[ERR -xxxx]` 前缀，最后 INTERNAL */
export function getErrorCode(err: unknown): DlientErrorCode {
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'number') {
    return (err as { code: number }).code as DlientErrorCode
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return parseErrCodeFromMessage(message) ?? DlientErrorCode.INTERNAL
}

/** 结构化错误（渲染层 catch 后 err.code 可判断；message 与宿主/worker 一致） */
export class DlientError extends Error {
  readonly code: DlientErrorCode
  readonly detail?: unknown

  constructor(code: DlientErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'DlientError'
    this.code = code
    this.detail = detail
  }
}

// ---- 信封解析 / 错误提示 helpers（跨插件 renderer 统一消费 { code, msg, data, from }）----

/** 判断信封是否成功（code===0） */
export function isApiOk<T>(res: ApiResponse<T> | null | undefined): res is ApiResponse<T> & { code: 0 } {
  return !!res && res.code === 0
}

/** 将多语言 msg 解析为字符串（对象取当前 locale，缺省回退 enUS/zhCN） */
export function resolveApiMsg(msg: ResponseErrorMsg | undefined, locale: string): string {
  if (msg == null) return ''
  if (typeof msg === 'string') return msg
  const o = msg as Record<string, string | undefined>
  // 归一化 locale 键：渲染层 useI18n 为 'zh-CN'/'en-US'，信封对象键为 zhCN/enUS
  const norm =
    locale === 'zhCN' || locale === 'zh-CN' || locale === 'zh' ? 'zhCN' : locale === 'enUS' || locale === 'en-US' || locale === 'en' ? 'enUS' : locale
  return o[norm] ?? o.enUS ?? o.zhCN ?? ''
}

/** 未携带 msg 时按错误码给出默认文案（上层可覆盖） */
export function defaultApiErrorMsg(code: number, locale: string): string {
  const isEn = locale === 'enUS' || locale === 'en-US' || locale === 'en'
  return isEn ? `Request failed (${code})` : `请求失败（${code}）`
}

/** 结构化响应错误：catch 后 err.code / err.message(=解析后 msg) 可用 */
export class ApiError<T = unknown> extends Error {
  readonly code: number
  readonly raw?: ApiResponse<T>
  constructor(code: number, message: string, raw?: ApiResponse<T>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.raw = raw
  }
}

/** 取 data：成功返回业务数据，失败回退 fallback（列表 / 静默请求用） */
export function apiData<T>(res: ApiResponse<T> | null | undefined, fallback: T): T {
  return res && res.code === 0 ? (res.data as T) : fallback
}

/** 校验成功并解包：成功返回 data，失败抛 ApiError（code 为业务/宿主错误码） */
export function unwrapApi<T>(res: ApiResponse<T> | null | undefined, locale = 'zhCN'): T {
  if (!res || res.code !== 0) {
    const code = res?.code ?? DlientErrorCode.INTERNAL
    const msg = resolveApiMsg(res?.msg, locale) || defaultApiErrorMsg(code, locale)
    throw new ApiError<T>(code, msg, res ?? undefined)
  }
  return res.data as T
}

/** 请求并解包（静态回退）：失败时返回 fallback，等价旧的 request().catch(() => fallback) */
export async function apiOr<T>(p: Promise<ApiResponse<T>>, fallback: T, locale = 'zhCN'): Promise<T> {
  try {
    return unwrapApi(await p, locale)
  } catch {
    return fallback
  }
}

/** 将任意捕获值（Error / 信封 / 字符串）规整为 ApiError（渲染层统一取 code/msg 提示） */
export function toApiError(err: unknown, locale = 'zhCN'): ApiError {
  if (err instanceof ApiError) return err
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'number') {
    const e = err as ApiResponse
    return new ApiError(e.code, resolveApiMsg(e.msg, locale) || defaultApiErrorMsg(e.code, locale), e)
  }
  const code = getErrorCode(err)
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return new ApiError(code, message || defaultApiErrorMsg(code, locale))
}

/** request / listen 的选项：plugin 缺省 = 自调用本插件 worker；data 为大块数据（transfer 零拷贝） */
export interface RequestOptions {
  plugin?: string
  data?: ArrayBuffer
}

/** listen 返回的取消控制器（abort() 通知 worker 发 cancel） */
export interface ListenController {
  abort(): void
  readonly signal: {
    readonly aborted: boolean
    addEventListener(cb: () => void): () => void
  }
}

/** 插件自有日志增量读取结果（todo 7.3.10：主进程记账，只回传完整新增行） */
export interface PluginLogReadResult {
  /** 完整 JSONL 行（已切好行，逐行 JSON.parse 即可） */
  lines: string[]
  /** 下次续读起点（= 本次读到的文件大小；渲染层原样传回） */
  offset: number
  /** 轮转 / 单次增量超限 → 渲染层应清空列表重来（lines 为新一批全量） */
  reset: boolean
  /** 首帧/重置时超 maxBytes 截尾（有更早日志被丢弃） */
  truncated: boolean
}

/** JSONL 单条日志（ts/level/source/msg 为约定字段，data 展开到顶层；其余键程序化分析用） */
export interface PluginLogEntry {
  ts?: string
  level?: string
  source?: string
  msg?: string
  [key: string]: unknown
}

/** 插件日志实时推送条目（宿主日志写入 → 'plugin-log' 事件，LogViewer 订阅接收用） */
export interface PluginLogPushEntry {
  pluginId: string
  line: string
}

/** 批量申请跨插件能力的结果：granted = 已授权可调用（含已授权/免确认档）；denied = 用户拒绝或不可授权 */
export interface PermissionResult {
  granted: string[]
  denied: string[]
}

/* ------------------------------------------------------------------ */
/* UI 端直连 host-api（docs/guides/ui-host-api.md）：api.{module}.{method}(...) */
/* ------------------------------------------------------------------ */

/** UI 直连 host-api 方法签名（参数/返回透传；host 侧按 UI_OPEN_METHODS 白名单校验） */
export type UiHostCall = (...args: any[]) => Promise<any>

/** UI 端可直连模块（方法名 = host-api key；child.* / plugin.invoke / os.* 等按 §4 不开放） */
export interface UiHostApi {
  app: {
    getVersion: HostApiMap['app.getVersion']
    getName: HostApiMap['app.getName']
    getLocale: HostApiMap['app.getLocale']
    getLocaleCountryCode: HostApiMap['app.getLocaleCountryCode']
    getSystemLocale: HostApiMap['app.getSystemLocale']
    getPreferredSystemLanguages: HostApiMap['app.getPreferredSystemLanguages']
    getPath: HostApiMap['app.getPath']
    isActive: HostApiMap['app.isActive']
    isHidden: HostApiMap['app.isHidden']
    notify: HostApiMap['app.notify']
    data: { read: HostApiMap['app.data.read']; write: HostApiMap['app.data.write'] }
    crypt: { encrypt: HostApiMap['app.crypt.encrypt']; decrypt: HostApiMap['app.crypt.decrypt'] }
  }
  i18n: { getLocale: HostApiMap['i18n.getLocale'] }
  log: { write: HostApiMap['log.write'] }
  system: { getIdleState: HostApiMap['system.getIdleState'] }
  net: {
    isOnline: HostApiMap['net.isOnline']
    fetch: HostApiMap['net.fetch']
    request: HostApiMap['net.request']
  }
  dialog: {
    showOpenDialog: HostApiMap['dialog.showOpenDialog']
    showSaveDialog: HostApiMap['dialog.showSaveDialog']
    showMessageBox: HostApiMap['dialog.showMessageBox']
  }
  notification: {
    isSupported: HostApiMap['notification.isSupported']
    /** send 返回句柄（事件经渲染层 'notification-event' 订阅回推，支持 on(...) 监听） */
    send: (options: NotificationSendOptions) => Promise<NotificationHandle>
    remove: HostApiMap['notification.remove']
    removeGroup: HostApiMap['notification.removeGroup']
    subscribe: HostApiMap['notification.subscribe']
    unsubscribe: HostApiMap['notification.unsubscribe']
  }
  fs: {
    read: HostApiMap['fs.read']
    stat: HostApiMap['fs.stat']
    listDir: HostApiMap['fs.listDir']
    watch: HostApiMap['fs.watch']
    unwatch: HostApiMap['fs.unwatch']
    mkdir: HostApiMap['fs.mkdir']
    write: HostApiMap['fs.write']
    append: HostApiMap['fs.append']
    delete: HostApiMap['fs.delete']
    copyDir: HostApiMap['fs.copyDir']
    lock: HostApiMap['fs.lock']
    unlock: HostApiMap['fs.unlock']
    withLock: HostApiMap['fs.withLock']
  }
  clipboard: {
    readText: HostApiMap['clipboard.readText']
    readHTML: HostApiMap['clipboard.readHTML']
    readRTF: HostApiMap['clipboard.readRTF']
    readBookmark: HostApiMap['clipboard.readBookmark']
    readFindText: HostApiMap['clipboard.readFindText']
    readImage: HostApiMap['clipboard.readImage']
    readBuffer: HostApiMap['clipboard.readBuffer']
    read: HostApiMap['clipboard.read']
    has: HostApiMap['clipboard.has']
    availableFormats: HostApiMap['clipboard.availableFormats']
    writeText: HostApiMap['clipboard.writeText']
    writeHTML: HostApiMap['clipboard.writeHTML']
    writeImage: HostApiMap['clipboard.writeImage']
    writeRTF: HostApiMap['clipboard.writeRTF']
    writeBookmark: HostApiMap['clipboard.writeBookmark']
    writeFindText: HostApiMap['clipboard.writeFindText']
    writeBuffer: HostApiMap['clipboard.writeBuffer']
    write: HostApiMap['clipboard.write']
    clear: HostApiMap['clipboard.clear']
  }
  permission: { request: HostApiMap['permission.request'] }
  plugin: { capabilities: HostApiMap['plugin.capabilities'] }
}

/** UI 端可直连 host-api 点路径（与宿主 export.ts UI_OPEN_METHODS 同源；改这里须同步宿主） */
export const UI_HOST_API_PATHS: string[] = [
  // app
  'app.getVersion', 'app.getName', 'app.getLocale', 'app.getLocaleCountryCode', 'app.getSystemLocale',
  'app.getPreferredSystemLanguages', 'app.getPath', 'app.isActive', 'app.isHidden', 'app.notify',
  'app.data.read', 'app.data.write', 'app.crypt.encrypt', 'app.crypt.decrypt',
  // i18n / system / net
  'i18n.getLocale', 'system.getIdleState', 'net.isOnline', 'net.fetch', 'net.request',
  // log
  'log.write',
  // dialog / notification
  'dialog.showOpenDialog', 'dialog.showSaveDialog', 'dialog.showMessageBox',
  'notification.isSupported', 'notification.send', 'notification.remove', 'notification.removeGroup',
  'notification.subscribe', 'notification.unsubscribe',
  // fs
  'fs.read', 'fs.stat', 'fs.listDir', 'fs.watch', 'fs.unwatch',
  'fs.mkdir', 'fs.write', 'fs.append', 'fs.delete', 'fs.copyDir', 'fs.lock', 'fs.unlock', 'fs.withLock',
  // clipboard
  'clipboard.readText', 'clipboard.readHTML', 'clipboard.readRTF', 'clipboard.readBookmark',
  'clipboard.readFindText', 'clipboard.readImage', 'clipboard.readBuffer', 'clipboard.read',
  'clipboard.has', 'clipboard.availableFormats',
  'clipboard.writeText', 'clipboard.writeHTML', 'clipboard.writeImage', 'clipboard.writeRTF',
  'clipboard.writeBookmark', 'clipboard.writeFindText', 'clipboard.writeBuffer', 'clipboard.write',
  'clipboard.clear',
  // permission / plugin
  'permission.request', 'plugin.capabilities',
]

/** 构建 api.xxx.xxx 模块树（叶子函数执行 UI host-api 调用；child 等不开放模块不入树） */
export function createHostApiProxy(call: (method: string, args: unknown[]) => Promise<unknown>): UiHostApi {
  const root: Record<string, unknown> = {}
  for (const path of UI_HOST_API_PATHS) {
    const parts = path.split('.')
    const method = parts.pop() as string
    let node = root
    for (const p of parts) {
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {}
      node = node[p] as Record<string, unknown>
    }
    node[method] = (...args: unknown[]) => call(path, args)
  }
  return root as unknown as UiHostApi
}

export interface PluginApi extends UiHostApi {
  /** 当前视图绑定的插件 ID（宿主注入；渲染层 store/event 的身份与命名空间依据） */
  pluginId: string
  /** 当前插件的组织标识（'@xxx'，宿主 resolveOrg 判定后注入；undefined = 无组织，org 层禁用） */
  organization?: string
  /** 单响应请求：plugin 缺省连自己的 worker，传 { plugin } 跨插件直连目标 worker。
   *  成功/失败统一 resolve 信封 { code, msg, data, from }，never throw。 */
  request: <T = unknown>(method: string, args?: unknown[], opts?: RequestOptions) => Promise<ApiResponse<T>>
  /** 流式请求：listener 逐块回调，返回 { abort, signal } 取消控制器 */
  listen: (
    method: string,
    args: unknown[],
    listener: (chunk: unknown, data?: ArrayBuffer) => void,
    opts?: RequestOptions,
  ) => ListenController
  /** 推送订阅（worker push → 渲染层） */
  onEvent: (name: string, cb: (data: unknown) => void) => () => void
  /** 读取插件日志（增量 tail：传 offset 只回传其后新行；LogViewer 等分析组件用）。
   *  options.filterId 非空 = 跨插件读取 dev 插件 '<filterId>@dev' 日志（宿主授权确认 + 1 天有效；只读本插件时缺省） */
  readPluginLogs: (options?: { offset?: number; maxBytes?: number; filterId?: string }) => Promise<PluginLogReadResult>
  /** 订阅日志推送（'plugin-log' 事件）。filterId 非空 = 跨插件订阅 dev 插件 '<filterId>@dev' 日志
   *  （宿主授权确认 + 1 天有效；dev 实例日志以 '<filterId>@dev' 身份推送，本插件日志缺省）。返回取消订阅函数。 */
  subscribeLogs: (cb?: (entry: PluginLogPushEntry) => void, filterId?: string) => () => void
  /** 清空插件日志（LogViewer 删除图标用）。filterId 非空 = 跨插件清空 dev 插件 '<filterId>@dev' 日志（宿主授权确认） */
  clearLogs: (filterId?: string) => Promise<unknown>
  /** 批量申请跨插件能力（'pluginId.method' 数组）：一次性向宿主申请调用其它插件的能力。
   *  仅 runtime-confirm 档弹授权确认框（多个能力合并一个弹框），其余直接返回授权状态。 */
  requestPermissions: (capabilities: string[]) => Promise<ApiResponse<PermissionResult>>
}

export const PluginApiContext = createContext<PluginApi | null>(null)

/** 插件组件访问「绑定本视图」的实例 API（连自己的 worker） */
export function useDlientApi(): PluginApi {
  const api = useContext(PluginApiContext)
  if (!api) throw new Error('useDlientApi must be used inside <PluginView>')
  return api
}

/**
 * @deprecated 旧拼写（已更正为 useDlientApi）。保留仅用于过渡期兼容 registry 上仍按
 * 旧名 re-export 的 @dlient-open/ui（≤5.0.1）等既有安装；新代码一律使用 useDlientApi。
 */
export const useDientApi: typeof useDlientApi = useDlientApi
