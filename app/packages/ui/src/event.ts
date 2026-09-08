/**
 * event.ts - 插件渲染层事件传递（docs/specs/store-event.md「方案二：Event」）。
 *
 * 无状态消息广播：跨组件 / 跨插件 / 跨组织的一次性通知，可精确按发布者过滤。
 * 不存数据、无回读、无权限（广播语义），与 Store 完全独立。
 * 命名空间（3 层）：
 *   - event（self）：仅本插件可收；
 *   - event.org：同组织插件可收（依赖 api.organization，无组织 → 禁用）；
 *   - event.global：所有插件可收，监听可传发布者过滤数组（插件 id / '@host'）。
 * 发布者：插件 emit → 自己 pluginId；宿主 emit → '@host'（emitHostEvent，宿主专用）。
 * 无 replay：on 注册晚于 emit 收不到；once 触发一次即注销。
 */

import { useMemo } from 'react'
import { useDlientApi } from '@dlient-open/api-bridge'

export interface EventMeta {
  /** 事件名 */
  name: string
  /** 发布者：插件 id 或 '@host' */
  publisher: string
  /** 发布者所属组织（'@xxx'；无组织 undefined） */
  publisherOrg?: string
  /** 发布时间戳 */
  ts: number
}

export type DientEventCallback = (payload: unknown, meta: EventMeta) => void

interface Listener {
  cb: DientEventCallback
  /** 监听者身份（org 层路由用） */
  identity: { pluginId: string; organization?: string }
  /** global 层发布者过滤白名单；缺省 = 监听全部 */
  publishers?: string[]
  /** once：触发一次后自动移除 */
  once?: boolean
}

class EventBus {
  private listeners = new Map<string, Set<Listener>>()

  /** 注册监听；返回取消订阅函数 */
  add(namespacedName: string, listener: Listener): () => void {
    let set = this.listeners.get(namespacedName)
    if (!set) {
      set = new Set()
      this.listeners.set(namespacedName, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(namespacedName)
    }
  }

  /** 分发（发布者过滤；once 触发后移除） */
  dispatch(namespacedName: string, meta: EventMeta, payload: unknown): void {
    const set = this.listeners.get(namespacedName)
    if (!set) return
    for (const listener of Array.from(set)) {
      if (listener.publishers && !listener.publishers.includes(meta.publisher)) continue
      try {
        listener.cb(payload, meta)
      } catch {
        /* 监听器异常不中断其它监听 */
      }
      if (listener.once) {
        set.delete(listener)
        if (set.size === 0) this.listeners.delete(namespacedName)
      }
    }
  }
}

/** 全局单例（宿主与所有插件经 SystemJS 共享同一份 @dlient-open/ui 实例） */
const eventBus = new EventBus()

// ---- 身份绑定 event ----

export interface DientEventScope {
  emit(name: string, payload?: unknown): void
  on(name: string, cb: DientEventCallback): () => void
  once(name: string, cb: DientEventCallback): () => void
}

export interface DientEventGlobalScope {
  emit(name: string, payload?: unknown): void
  /** publishers 过滤数组（插件 id / '@host'）：不传 = 监听全部发布者 */
  on(name: string, cb: DientEventCallback, publishers?: string[]): () => void
  once(name: string, cb: DientEventCallback, publishers?: string[]): () => void
}

export interface DientEvent {
  /** 本插件命名空间 */
  emit(name: string, payload?: unknown): void
  on(name: string, cb: DientEventCallback): () => void
  once(name: string, cb: DientEventCallback): () => void
  /** 组织命名空间（无组织 → emit 静默忽略 / on 返回空取消） */
  org: DientEventScope
  /** 全局命名空间（可按发布者过滤） */
  global: DientEventGlobalScope
}

function createBoundEvent(identity: { pluginId: string; organization?: string }): DientEvent {
  const publisher = identity.pluginId
  const publisherOrg = identity.organization

  const meta = (name: string): EventMeta => ({ name, publisher, publisherOrg, ts: Date.now() })

  const emitSelf = (name: string, payload?: unknown): void => {
    eventBus.dispatch(`self:${publisher}:${name}`, meta(name), payload)
  }
  const onSelf = (name: string, cb: DientEventCallback): (() => void) =>
    eventBus.add(`self:${publisher}:${name}`, { cb, identity })
  const onceSelf = (name: string, cb: DientEventCallback): (() => void) =>
    eventBus.add(`self:${publisher}:${name}`, { cb, identity, once: true })

  // 组织层：同组织插件共享命名空间（org:<orgId>:<name>）
  const org = {
    emit: (name: string, payload?: unknown): void => {
      if (!identity.organization) return
      eventBus.dispatch(`org:${identity.organization}:${name}`, meta(name), payload)
    },
    on: (name: string, cb: DientEventCallback): (() => void) =>
      identity.organization
        ? eventBus.add(`org:${identity.organization}:${name}`, { cb, identity })
        : () => undefined,
    once: (name: string, cb: DientEventCallback): (() => void) =>
      identity.organization
        ? eventBus.add(`org:${identity.organization}:${name}`, { cb, identity, once: true })
        : () => undefined,
  }

  // 全局层：所有插件共享（global:<name>），按发布者过滤
  const global = {
    emit: (name: string, payload?: unknown): void => {
      eventBus.dispatch(`global:${name}`, meta(name), payload)
    },
    on: (name: string, cb: DientEventCallback, publishers?: string[]): (() => void) =>
      eventBus.add(`global:${name}`, {
        cb,
        identity,
        publishers: Array.isArray(publishers) && publishers.length > 0 ? publishers.map(String) : undefined,
      }),
    once: (name: string, cb: DientEventCallback, publishers?: string[]): (() => void) =>
      eventBus.add(`global:${name}`, {
        cb,
        identity,
        publishers: Array.isArray(publishers) && publishers.length > 0 ? publishers.map(String) : undefined,
        once: true,
      }),
  }

  return { emit: emitSelf, on: onSelf, once: onceSelf, org, global }
}

/** 取当前视图身份（useDlientApi；弹窗隔离根经 withContext 已注入） */
function useEventIdentity(): { pluginId: string; organization?: string } {
  const api = useDlientApi()
  return useMemo(() => ({ pluginId: api.pluginId, organization: api.organization }), [api])
}

/**
 * 获取绑定身份的事件总线（跨组件共享同一实例；事件自 / 组织 / 全局三层命名隔离）。
 * 身份不可伪造：pluginId / organization 由宿主 PluginView 注入。
 */
export function useDientEvent(): DientEvent {
  const identity = useEventIdentity()
  return useMemo(() => createBoundEvent(identity), [identity])
}

/**
 * 宿主专用：以 '@host' 发布者发全局事件（插件侧 event.global.on(name, cb, ['@host']) 可收）。
 * 仅宿主渲染层调用；插件无权限伪造 '@host'（软约束：身份注入通道未暴露）。
 */
export function emitHostEvent(name: string, payload?: unknown): void {
  const meta: EventMeta = { name, publisher: '@host', ts: Date.now() }
  eventBus.dispatch(`global:${name}`, meta, payload)
}
