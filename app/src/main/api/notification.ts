/**
 * api/notification.ts - notification 模块 host-api（v2，docs/specs/notification-v2.md）。
 *
 * 职责：
 *  - 统一注册表记账（NotificationRegistry）：send 时记 owner（instanceKey）/ channel / viewId / engine，
 *    remove / removeGroup 按 owner 裁决，系统与内置（in-app）双引擎同步关闭；
 *  - 参数默认值注入（group_id/subtitle/icon 按插件身份推导，见 parseOptions）；
 *  - 句柄事件模型：subscribe/unsubscribe 订阅，事件（click/close/reply/action/failed/show）
 *    按 owner 回推（worker 控制面 / UI view），send 与订阅之间的竞态用缓冲回放消除；
 *  - 引擎分发：macOS 前台 → 内置通知视图（NotifyViewer）；其余 → Electron Notification。
 *
 * 外部装配（index.ts）：
 *  - registerNotificationMetaProvider(fn)     插件名称/图标解析（i18n）
 *  - registerNotificationSink(fn)             事件回推（worker / ui 目标）
 *  - registerNotificationViewer(v)            内置通知条（NotifyViewer）
 */
import { BrowserWindow, Notification } from 'electron'
import { DlientError, DlientErrorCode } from '@dlient-open/core'
import type { ApiDefinition } from './types'
import type { HostApiCallContext } from '../export'

/** 通知句柄事件名（句柄 on() 支持集合） */
export type NotificationEventName = 'click' | 'close' | 'reply' | 'action' | 'failed' | 'show'
/** 事件载荷（action 带 index、reply 带文本、failed 带 error） */
export interface NotificationEventPayload {
  index?: number
  reply?: string
  error?: string
}

/** 通知引擎：system = Electron 原生；in-app = 内置通知条（NotifyViewer） */
type NotifyEngine = 'system' | 'in-app'

/** 规范化入参（与 §4.2 参数模型一致；缺省值由插件身份注入） */
interface ParsedNotificationOptions {
  title: string
  body: string
  group_id: string
  group_title?: string
  subtitle?: string
  icon?: string
  silent: boolean
  hasReply: boolean
  replyPlaceholder?: string
  actions: { type: 'button' | 'reply'; text: string }[]
  closeButtonText?: string
  timeoutType: 'default' | 'never'
}

/** 注册表条目（双引擎统一记账） */
interface RegistryEntry {
  id: string
  /** 发送方插件 instanceKey（remove/removeGroup/事件归属裁决依据） */
  owner: string
  channel: 'worker' | 'ui'
  /** UI 直连发起视图 id（事件回推目标） */
  viewId?: string
  engine: NotifyEngine
  instance?: Notification
  group: string
  /** 是否含交互控件（actions/hasReply）→ 内置驻留、系统提示行为 */
  hasInteraction: boolean
  subscribed: boolean
  /** 事件缓冲（subscribe 到达前回放；上限避免无界增长） */
  pending: Array<{ event: NotificationEventName; payload?: NotificationEventPayload }>
}

const registry = new Map<string, RegistryEntry>()
let seq = 0

/** 事件回推目标（worker → 控制面；ui → 指定 view） */
export type NotifySinkTarget = { channel: 'worker'; pluginId: string } | { channel: 'ui'; viewId: string }
export type NotifySink = (target: NotifySinkTarget, payload: { id: string; event: NotificationEventName; payload?: NotificationEventPayload }) => void

let metaProvider: ((pluginId: string) => { name?: string; icon?: string } | null) | null = null
export function registerNotificationMetaProvider(
  fn: (pluginId: string) => { name?: string; icon?: string } | null,
): void {
  metaProvider = fn
}

let sink: NotifySink | null = null
export function registerNotificationSink(fn: NotifySink): void {
  sink = fn
}

/** 内置通知条接口（NotifyViewer 装配；null = 未启用内置） */
export interface NotifyViewerLike {
  show(opts: {
    id: string
    owner: string
    group_id: string
    title: string
    body: string
    subtitle?: string
    icon?: string
    hasReply: boolean
    replyPlaceholder?: string
    actions: { type: 'button' | 'reply'; text: string }[]
    closeButtonText?: string
    timeoutType: 'default' | 'never'
  }): void
  dismissById(id: string): void
  dismissByOwner(owner: string): void
}
let viewer: NotifyViewerLike | null = null
export function registerNotificationViewer(v: NotifyViewerLike | null): void {
  viewer = v
}

/** 内置通知条交互/超时回推（NotifyViewer 回调） */
export function notifyAppEvent(id: string, event: NotificationEventName, payload?: NotificationEventPayload): void {
  const rec = registry.get(id)
  if (!rec) return
  emitEvent(rec, event, payload)
  if (event === 'close' || event === 'failed') registry.delete(id)
}

/** 规范化入参：身份字段（group_id/group_title/subtitle/icon）由宿主按来源插件推导注入，忽略插件自报（防伪装/冒牌）；只读内容字段 */
function parseOptions(opts: unknown, ctx: HostApiCallContext): ParsedNotificationOptions {
  const o = (opts ?? {}) as Record<string, unknown>
  const pluginId = ctx.pluginId
  const meta = metaProvider?.(pluginId) ?? undefined
  const actions = Array.isArray(o.actions)
    ? (o.actions as unknown[]).filter(
        (a): a is { type: 'button' | 'reply'; text: string } =>
          !!a && typeof a === 'object' && (a as { type?: unknown }).type !== undefined && typeof (a as { text?: unknown }).text === 'string',
      )
    : []
  return {
    title: String(o.title ?? ''),
    body: typeof o.body === 'string' ? o.body : '',
    // 身份字段：host 强制注入（group_id = 插件 instanceKey；group_title/subtitle = 插件名 i18n；icon = 插件图标）
    group_id: pluginId,
    group_title: meta?.name,
    subtitle: meta?.name,
    icon: meta?.icon,
    silent: o.silent === true,
    hasReply: o.hasReply === true,
    replyPlaceholder: typeof o.replyPlaceholder === 'string' ? o.replyPlaceholder : undefined,
    actions,
    closeButtonText: typeof o.closeButtonText === 'string' ? o.closeButtonText : undefined,
    timeoutType: o.timeoutType === 'never' ? 'never' : 'default',
  }
}

/** macOS 前台判定（引擎分发）：主窗口可见、未最小化、获得焦点 */
function isAppForeground(): boolean {
  if (process.platform !== 'darwin') return false
  const win = BrowserWindow.getFocusedWindow()
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()
}

/** 事件回推（已订阅 → 实时推；未订阅 → 缓冲待 subscribe 回放） */
function emitEvent(rec: RegistryEntry, event: NotificationEventName, payload?: NotificationEventPayload): void {
  if (rec.subscribed) {
    if (rec.channel === 'worker') {
      sink?.({ channel: 'worker', pluginId: rec.owner }, { id: rec.id, event, payload })
    } else if (rec.viewId) {
      sink?.({ channel: 'ui', viewId: rec.viewId }, { id: rec.id, event, payload })
    }
  } else if (rec.pending.length < 10) {
    rec.pending.push({ event, payload })
  }
}

/** 关闭并回推 close（双引擎统一出口；幂等） */
function closeRecord(id: string): void {
  const rec = registry.get(id)
  if (!rec) return
  emitEvent(rec, 'close')
  registry.delete(id)
}

/** 双引擎关闭：system → Notification.close()（其 close 事件幂等回推）；in-app → 通知条移除 */
function dismiss(id: string): void {
  const rec = registry.get(id)
  if (!rec) return
  if (rec.engine === 'system') {
    closeRecord(id)
    try {
      rec.instance?.close()
    } catch {
      /* 已关闭忽略 */
    }
  } else {
    closeRecord(id)
    viewer?.dismissById(id)
  }
}

export const notificationApis: ApiDefinition[] = [
  {
    key: 'notification.isSupported',
    description: { 'zh-CN': '系统通知是否可用', 'en-US': 'Whether system notifications are supported' },
    scope: 'all',
    level: 'default',
    handler: () => Notification.isSupported(),
  },
  {
    key: 'notification.send',
    description: { 'zh-CN': '发送系统通知，返回句柄 { id }（支持 on("click"/"close"/"reply"/"action"/"failed"/"show")）', 'en-US': 'Send notification, returns handle { id } (on click/close/reply/action/failed/show)' },
    scope: 'all',
    level: 'default',
    handler: ([opts], ctx) => {
      const p = parseOptions(opts, ctx)
      const id = `n${++seq}`
      const channel = ctx.channel ?? 'worker'
      const rec: RegistryEntry = {
        id,
        owner: ctx.pluginId,
        channel,
        viewId: ctx.viewId,
        engine: 'system',
        group: p.group_id,
        hasInteraction: p.hasReply || p.actions.length > 0,
        subscribed: false,
        pending: [],
      }
      // macOS 前台 → 内置通知条（引擎分发，§4.4）
      if (isAppForeground() && viewer) {
        rec.engine = 'in-app'
        registry.set(id, rec)
        viewer.show({
          id,
          owner: ctx.pluginId,
          group_id: p.group_id,
          title: p.title,
          body: p.body,
          subtitle: p.subtitle,
          icon: p.icon,
          hasReply: p.hasReply,
          replyPlaceholder: p.replyPlaceholder,
          actions: p.actions,
          closeButtonText: p.closeButtonText,
          timeoutType: p.timeoutType,
        })
        return { id }
      }
      // 系统引擎
      try {
        const notif = new Notification({
          title: p.title,
          body: p.body,
          silent: p.silent,
          subtitle: p.subtitle,
          icon: p.icon,
          // Electron NotificationAction 仅支持 'button'/'selection'；'reply' 型动作由 hasReply 承载，映射为 button
          actions: p.actions.map((a) => ({ type: 'button' as const, text: a.text })),
          closeButtonText: p.closeButtonText,
          hasReply: p.hasReply,
          replyPlaceholder: p.replyPlaceholder,
          timeoutType: p.timeoutType,
        })
        rec.instance = notif
        registry.set(id, rec)
        notif.on('click', () => {
          const r = registry.get(id)
          if (r) emitEvent(r, 'click')
        })
        notif.on('show', () => {
          const r = registry.get(id)
          if (r) emitEvent(r, 'show')
        })
        notif.on('close', () => closeRecord(id))
        notif.on('failed', (_event, err) => notifyAppEvent(id, 'failed', { error: err ? String(err) : undefined }))
        notif.on('action', (_event, index) => notifyAppEvent(id, 'action', { index: Number(index) }))
        notif.on('reply', (_event, reply) => notifyAppEvent(id, 'reply', { reply: String(reply ?? '') }))
        notif.show()
      } catch (err) {
        registry.delete(id)
        throw new DlientError(
          DlientErrorCode.INTERNAL,
          `notification.send failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return { id }
    },
  },
  {
    key: 'notification.remove',
    description: { 'zh-CN': '按 id 关闭通知（仅限本插件发送的；系统与内置均生效）', 'en-US': 'Close notification by id (own notifications only; system & in-app)' },
    scope: 'all',
    level: 'default',
    handler: ([id], ctx) => {
      const key = String(id ?? '')
      const rec = registry.get(key)
      if (!rec) return undefined // 幂等：不存在忽略
      if (rec.owner !== ctx.pluginId) {
        throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `notification.remove denied: not owner of "${key}"`)
      }
      dismiss(key)
      return undefined
    },
  },
  {
    key: 'notification.removeGroup',
    description: { 'zh-CN': '关闭本插件全部通知（不传组 id，按插件自身关闭；系统与内置均生效）', 'en-US': 'Close all notifications of this plugin (by owner; system & in-app)' },
    scope: 'all',
    level: 'default',
    handler: (_args, ctx) => {
      for (const rec of [...registry.values()]) {
        if (rec.owner === ctx.pluginId) dismiss(rec.id)
      }
      return undefined
    },
  },
  {
    key: 'notification.subscribe',
    description: { 'zh-CN': '订阅某条通知的事件（仅本插件发送的；句柄 on() 内部自动调用）', 'en-US': 'Subscribe to a notification events (own notifications only)' },
    scope: 'all',
    level: 'default',
    handler: ([opts], ctx) => {
      const id = String((opts as { id?: unknown } | null | undefined)?.id ?? '')
      const rec = registry.get(id)
      if (!rec || rec.owner !== ctx.pluginId) {
        throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `notification.subscribe denied: not owner of "${id}"`)
      }
      rec.subscribed = true
      // 回放订阅前缓冲的事件（消除 send 返回前的事件竞态）
      const buffered = rec.pending.splice(0)
      for (const e of buffered) emitEvent(rec, e.event, e.payload)
      return undefined
    },
  },
  {
    key: 'notification.unsubscribe',
    description: { 'zh-CN': '取消某条通知的事件订阅', 'en-US': 'Unsubscribe from a notification events' },
    scope: 'all',
    level: 'default',
    handler: ([opts], ctx) => {
      const id = String((opts as { id?: unknown } | null | undefined)?.id ?? '')
      const rec = registry.get(id)
      if (!rec || rec.owner !== ctx.pluginId) {
        throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `notification.unsubscribe denied: not owner of "${id}"`)
      }
      rec.subscribed = false
      return undefined
    },
  },
]
