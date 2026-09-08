/**
 * store.ts - 插件渲染层状态共享（docs/specs/store-event.md「方案一：Store」）。
 *
 * 三层命名空间，与 event 统一，身份来自 useDlientApi()（pluginId + organization）：
 *   - store（私有）    ：本插件私有（get / set / watch）
 *   - store.org        ：组织共享（get / set / watch），同组织插件可读写
 *   - store.global     ：全局（get / set / watch），按写入者分区（writerId ∈ { 插件 id, '@host' }）；
 *                        '@host' 为宿主专用；global.get / watch 缺省写入者 = '@host'
 *
 * 安全约束：渲染层同进程，模块可被 import 绕过 —— 身份注入与权限校验为软约束（强约束走宿主主进程）。
 * 数据仅内存驻留（不落盘）；敏感数据禁止入 store。watch 支持多层级前缀（aaa.bbb 监听 aaa.bbb.ccc）。
 */

import { useMemo, useSyncExternalStore } from 'react'
import { useDlientApi } from '@dlient-open/api-bridge'

export interface StoreIdentity {
  pluginId: string
  /** 组织标识（'@xxx'）；undefined = 无组织，org 层禁用 */
  organization?: string
}

type Source = 'private' | 'org' | 'global'

/** watch 回调：cb(prev, next, actualKey)，prev/next 为对象值引用 */
export type StoreWatchCallback = (prev: unknown, next: unknown, actualKey: string) => void

/** 监听 key 拆前缀：'aaa.bbb.ccc' → ['aaa', 'aaa.bbb', 'aaa.bbb.ccc'] */
function splitPrefixes(path: string): string[] {
  const parts = path.split('.')
  const out: string[] = []
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('.'))
  return out
}

class GlobalStore {
  private privateData = new Map<string, Map<string, unknown>>()
  private orgData = new Map<string, Map<string, unknown>>()
  private globalData = new Map<string, Map<string, unknown>>()

  /** watch 监听表：'<source>:<ns>:<prefix>' → 监听器集合 */
  private watchers = new Map<string, Set<StoreWatchCallback>>()
  /** React 订阅表：'<source>:<ns>:<path>' → 无参回调（useSyncExternalStore 细粒度订阅） */
  private reactSubs = new Map<string, Set<() => void>>()

  // ---- 订阅 ----

  watchKey(source: Source, ns: string, prefix: string): string {
    return `${source}:${ns}:${prefix}`
  }

  addWatcher(key: string, cb: StoreWatchCallback): () => void {
    let set = this.watchers.get(key)
    if (!set) {
      set = new Set()
      this.watchers.set(key, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) this.watchers.delete(key)
    }
  }

  subscribe(pathKey: string, cb: () => void): () => void {
    let set = this.reactSubs.get(pathKey)
    if (!set) {
      set = new Set()
      this.reactSubs.set(pathKey, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) this.reactSubs.delete(pathKey)
    }
  }

  /** 通知：set 后对拆分出的全部前缀派发（watcher 前缀命中；React 仅精确 path 命中） */
  private notify(source: Source, ns: string, path: string, prev: unknown, next: unknown): void {
    const prefixes = splitPrefixes(path)
    for (const prefix of prefixes) {
      const set = this.watchers.get(this.watchKey(source, ns, prefix))
      if (set) {
        for (const cb of Array.from(set)) {
          try {
            cb(prev, next, path)
          } catch {
            /* 监听器异常不中断其它监听 */
          }
        }
      }
    }
    const reactSet = this.reactSubs.get(this.watchKey(source, ns, path))
    if (reactSet) {
      for (const cb of Array.from(reactSet)) cb()
    }
  }

  // ---- 数据操作 ----

  private ensure(map: Map<string, Map<string, unknown>>, ns: string): Map<string, unknown> {
    let m = map.get(ns)
    if (!m) {
      m = new Map()
      map.set(ns, m)
    }
    return m
  }

  private nsMap(source: Source, ns: string): Map<string, unknown> | null {
    if (source === 'private') return this.ensure(this.privateData, ns)
    if (source === 'org') return this.ensure(this.orgData, ns)
    if (source === 'global') return this.ensure(this.globalData, ns)
    return null
  }

  get(source: Source, ns: string, path: string): unknown {
    return this.nsMap(source, ns)?.get(path)
  }

  /** 写值并派发通知（同值未变不通知） */
  setValue(source: Source, ns: string, path: string, value: unknown): void {
    const map = this.nsMap(source, ns)
    if (!map) return
    const prev = map.get(path)
    if (prev === value) return
    map.set(path, value)
    this.notify(source, ns, path, prev, value)
  }
}

/** 全局单例（宿主渲染层与所有插件经 SystemJS 共享同一份 @dlient-open/ui 实例） */
const globalStore = new GlobalStore()

// ---- 身份绑定 store ----

export interface DientStoreScope {
  get<T = unknown>(key: string, fallback?: T): T | undefined
  set(key: string, value: unknown): void
  watch(key: string, cb: StoreWatchCallback): () => void
}

export interface DientStoreGlobalScope {
  /** writerId 缺省 = '@host'（宿主专用命名空间） */
  get<T = unknown>(key: string, writerId?: string): T | undefined
  /** 写入者 = 当前插件自身 */
  set(key: string, value: unknown): void
  watch(key: string, cb: StoreWatchCallback, writerId?: string): () => void
}

export interface DientStore {
  /** 私有（本插件） */
  get<T = unknown>(key: string, fallback?: T): T | undefined
  set(key: string, value: unknown): void
  watch(key: string, cb: StoreWatchCallback): () => void
  /** 组织（本组织；无组织 → 禁用） */
  org: DientStoreScope
  /** 全局（按写入者分区；'@host' 宿主专用） */
  global: DientStoreGlobalScope
}

function createBoundStore(identity: StoreIdentity): DientStore {
  const keyOf = (source: Source, ns: string, key: string) => globalStore.watchKey(source, ns, key)

  // 私有
  const get = <T,>(key: string, fallback?: T): T | undefined => {
    const v = globalStore.get('private', identity.pluginId, key)
    return v === undefined ? fallback : (v as T)
  }
  const set = (key: string, value: unknown): void => {
    globalStore.setValue('private', identity.pluginId, key, value)
  }
  const watch = (key: string, cb: StoreWatchCallback): (() => void) =>
    globalStore.addWatcher(keyOf('private', identity.pluginId, key), cb)

  // 组织（本组织；无组织 → get undefined / set 抛错 / watch 空取消）
  const org: DientStoreScope = {
    get: <T,>(key: string, fallback?: T): T | undefined => {
      if (!identity.organization) return undefined
      const v = globalStore.get('org', identity.organization, key)
      return v === undefined ? fallback : (v as T)
    },
    set: (key: string, value: unknown): void => {
      if (!identity.organization) throw new Error('store.org.set: plugin has no organization')
      globalStore.setValue('org', identity.organization, key, value)
    },
    watch: (key: string, cb: StoreWatchCallback): (() => void) =>
      identity.organization
        ? globalStore.addWatcher(keyOf('org', identity.organization, key), cb)
        : () => undefined,
  }

  // 全局（按写入者分区；get/watch 缺省 '@host'）
  const global: DientStoreGlobalScope = {
    get: <T,>(key: string, writerId?: string): T | undefined =>
      globalStore.get('global', writerId ?? '@host', key) as T | undefined,
    set: (key: string, value: unknown): void => {
      globalStore.setValue('global', identity.pluginId, key, value)
    },
    watch: (key: string, cb: StoreWatchCallback, writerId?: string): (() => void) =>
      globalStore.addWatcher(keyOf('global', writerId ?? '@host', key), cb),
  }

  return { get, set, watch, org, global }
}

/**
 * 宿主专用：以 '@host' 写入全局 store（插件侧 store.global.get(key) / watch(key, cb) 缺省即读到）。
 * 仅宿主渲染层调用；插件无 '@host' 写入口（软约束：身份注入通道未暴露）。
 */
export function setHostGlobal(key: string, value: unknown): void {
  globalStore.setValue('global', '@host', key, value)
}

// ---- React hooks ----

/** 取当前视图身份（useDlientApi；弹窗隔离根经 withContext 已注入） */
function useIdentity(): StoreIdentity {
  const api = useDlientApi()
  return useMemo<StoreIdentity>(() => ({ pluginId: api.pluginId, organization: api.organization }), [api])
}

/**
 * 获取绑定身份的 store（三层命名空间：store / store.org / store.global）。
 * 身份不可伪造：pluginId / organization 由宿主 PluginView 注入。
 */
export function useDientStore(): DientStore {
  const identity = useIdentity()
  return useMemo(() => createBoundStore(identity), [identity])
}

/**
 * 响应式读取（useSyncExternalStore 细粒度订阅：仅目标 path 变化触发重渲染）。
 * scope：'self'（缺省）= 本插件私有；'org' = 本组织；'global' = 全局（writerId 缺省 '@host'）。
 * 读取需满足对应数据源权限（无权限返回 undefined）。
 */
export function useStoreValue<T = unknown>(
  key: string,
  scope?: 'self' | 'org' | 'global',
  writerId?: string,
): T | undefined {
  const identity = useIdentity()
  const sc = scope ?? 'self'
  let source: Source
  let ns: string
  if (sc === 'org') {
    source = 'org'
    ns = identity.organization ?? ''
  } else if (sc === 'global') {
    source = 'global'
    ns = writerId ?? '@host'
  } else {
    source = 'private'
    ns = identity.pluginId
  }
  const pathKey = globalStore.watchKey(source, ns, key)
  const snapshot = (): T | undefined => {
    if (source === 'org' && !identity.organization) return undefined
    return globalStore.get(source, ns, key) as T
  }
  return useSyncExternalStore(
    (cb) => globalStore.subscribe(pathKey, cb),
    snapshot,
    snapshot,
  )
}
