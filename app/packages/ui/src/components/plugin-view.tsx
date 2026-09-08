/**
 * PluginView + useDlientApi：渲染 / 内嵌插件组件，并提供「绑定本视图」的实例 API。
 *
 * 安全模型（视图签名）：
 *   - PluginView 挂载时生成 view_id + sign_key，经 window.dlient.setView 登记（preload 持有）；
 *   - useDlientApi 的 request / onEvent 用 sign_key 对 `view_id|plugin_id|method|timestamp`
 *     做 HMAC-SHA256 签名后交 preload，验签通过才转发主进程 → 目标 worker；
 *   - 渲染主世界拿不到 sign_key，无法伪造其它插件的签名。
 */

import React from 'react'
import ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOMClient from 'react-dom/client'
import * as I18n from '@dlient-open/i18n'
import * as Ui from '@dlient-open/ui'
import { PluginApiContext, createHostApiProxy, type PluginApi, type ListenController, type RequestOptions, type ApiResponse, type PermissionResult, type NotificationHandle, type NotificationEventPayload } from '@dlient-open/api-bridge'
import * as ApiBridge from '@dlient-open/api-bridge'
import { cn } from '../lib/utils'
import { Spinner } from './ui/spinner'
import { Empty } from './ui/empty'
import { Alert, AlertTitle, AlertDescription } from './ui/alert'
import { pluginScopeId, ensurePluginPortalContainer } from '../lib/plugin-portal'
import { modal as uiModal, type ModalOptions, type DialogOptions } from './modal'
// SystemJS：插件 UI 模块加载器（插件产物为 System.register 格式，external 的共享依赖
// 从 SystemJS registry 解析到宿主单实例，见 ensureSystemShared）。
// systemjs 是纯 IIFE 脚本（无 ESM 导出）：副作用导入执行后挂 globalThis.System。
import type { SystemJS as SystemJSInstance } from 'systemjs'
import 'systemjs'
const SystemJS: SystemJSInstance = (globalThis as unknown as { System: SystemJSInstance }).System

// useDlientApi / PluginApiContext / PluginApi 由 @dlient-open/api-bridge 提供（跨插件共享实例），
// 见 packages/api-bridge/src/index.ts。

export interface PluginViewProps {
  pluginId: string
  /** @deprecated SystemJS 单入口方案下不再使用，保留仅为 API 兼容 */
  module?: string
  /** 模块内要渲染的组件导出名（默认 'default'；具名导出如 'Webview'、'SettingsView' 等） */
  entry?: string
  /** 覆盖入口 URL（默认 dlientV3://plugin/<id>/dist/remoteEntry.js） */
  remoteEntryUrl?: string
  fallback?: React.ReactNode
  className?: string
  /** 透传给目标组件的外部 props */
  componentProps?: Record<string, unknown>
}

// 宿主共享模块注册进 SystemJS registry（单实例）。
// 插件构建把 react 系 / @dlient-open/api-bridge / @dlient-open/i18n / @dlient-open/ui 全部 external，
// 产物 System.register 的 deps 在运行时经 System.import 解析。
// SystemJS 6 的 registry key 必须是可解析 URL：裸依赖名先经 import map 映射到共享 URL，
// 再 System.set 到同一 URL。值对象由 set 自动包装成 module namespace。
const SHARED_MODULES = {
  'react': { default: React, ...(React as unknown as Record<string, unknown>) },
  'react/jsx-runtime': jsxRuntime as unknown as Record<string, unknown>,
  'react-dom': { default: ReactDOM, ...(ReactDOM as unknown as Record<string, unknown>) },
  'react-dom/client': ReactDOMClient as unknown as Record<string, unknown>,
  '@dlient-open/api-bridge': ApiBridge as unknown as Record<string, unknown>,
  '@dlient-open/i18n': I18n as unknown as Record<string, unknown>,
  '@dlient-open/ui': Ui as unknown as Record<string, unknown>,
} as const

let sharedInitialized = false
function ensureSystemShared(): void {
  if (sharedInitialized) return
  sharedInitialized = true
  const imports: Record<string, string> = {}
  for (const name of Object.keys(SHARED_MODULES)) {
    // 共享 URL：dlientV3://shared/<key>，纯 registry 占位（协议 handle 不会命中，仅作 key）
    const url = `dlientV3://shared/${name.replace(/\//g, '_').replace(/@/g, '')}`
    imports[name] = url
    SystemJS.set(url, SHARED_MODULES[name as keyof typeof SHARED_MODULES])
  }
  SystemJS.addImportMap({ imports })
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// 动态加载插件 UI（System.register 产物，external 共享依赖走 registry）。
// 瞬时失败重试：插件页首次加载偶发命中 dlientV3:// 协议未就绪 / 文件瞬时不可读（SystemJS Error#3，
// 即 script 加载失败），一次性失败会让整个插件页永久停留错误态；短退避重试可自愈。
async function loadPluginRemote(
  pluginId: string,
  remoteEntryUrl?: string,
  cacheBust = 0,
): Promise<Record<string, unknown>> {
  ensureSystemShared()
  const base = remoteEntryUrl ?? `dlientV3://plugin/${pluginId}/dist/remoteEntry.js`
  const url = cacheBust ? `${base}?t=${cacheBust}` : base
  const MAX_ATTEMPTS = 3
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    try {
      return (await withTimeout(
        SystemJS.import(url) as Promise<Record<string, unknown>>,
        10000,
        `Plugin ${pluginId} module load timeout`,
      )) as Record<string, unknown>
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 从模块取渲染组件（默认 default，兼容历史命名导出 Plugin） */
function extractEntry(mod: Record<string, unknown>, entry: string): React.ComponentType<Record<string, unknown>> | undefined {
  return (entry === 'default' ? (mod?.default ?? mod?.Plugin) : mod?.[entry]) as
    | React.ComponentType<Record<string, unknown>>
    | undefined
}

// ---- 视图身份与签名 ----

function genViewId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function genSignKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 用 sign_key 对 `view_id|plugin_id|subject|timestamp` 做 HMAC-SHA256 签名 */
function createSigner(viewId: string, pluginId: string, signKey: string) {
  const encoder = new TextEncoder()
  let keyPromise: Promise<CryptoKey> | null = null
  const getKey = () => {
    if (!keyPromise) {
      keyPromise = crypto.subtle.importKey(
        'raw',
        encoder.encode(signKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
    }
    return keyPromise
  }
  return async (subject: string, timestamp: number, extra?: string): Promise<string> => {
    const key = await getKey()
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${viewId}|${pluginId}|${subject}|${extra ?? ''}|${timestamp}`),
    )
    return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}

/**
 * api.notification UI 句柄特型：send 返回句柄（on/close），事件经 'notification-event' 订阅回推，
 * 与 worker 侧 rpc.notification 语义一致（docs/specs/notification-v2.md §4.3/§5.3）。
 * subscribe/unsubscribe 经 host-api 通道（宿主按 owner 校验，仅能订阅自己发送的通知）。
 */
function createUiNotificationModule(
  base: PluginApi['notification'],
  subscribeEvent: (name: string, cb: (data: unknown) => void, filterId?: string) => () => void,
  hostApiCall: (method: string, args: unknown[]) => Promise<unknown>,
): PluginApi['notification'] {
  const eventHandlers = new Map<string, Map<string, Array<(payload?: NotificationEventPayload) => void>>>()
  // 订阅渲染层 'notification-event'（宿主主进程按 viewId 定向推送，preload eventSubs 路由）
  subscribeEvent('notification-event', (data) => {
    const d = (data ?? {}) as { id?: string; event?: string; payload?: unknown } | null | undefined
    if (!d?.id || !d.event) return
    const cbs = eventHandlers.get(d.id)?.get(d.event)
    if (!cbs) return
    for (const cb of Array.from(cbs)) {
      try {
        cb(d.payload as NotificationEventPayload | undefined)
      } catch (err) {
        console.error('[plugin-view] notification event handler error:', err)
      }
    }
  })
  const makeHandle = (id: string): NotificationHandle => {
    const map = new Map<string, Array<(payload?: NotificationEventPayload) => void>>()
    eventHandlers.set(id, map)
    // 自动订阅（宿主已记账并缓冲 send 后、订阅前的事件，subscribe 回放）
    void hostApiCall('notification.subscribe', [{ id }]).catch(() => undefined)
    const handle: NotificationHandle = {
      id,
      on(event, cb) {
        const list = map.get(event) ?? []
        list.push(cb)
        map.set(event, list)
        return handle
      },
      close: async () => {
        eventHandlers.delete(id)
        await hostApiCall('notification.remove', [id])
      },
    }
    return handle
  }
  return {
    isSupported: () => base.isSupported(),
    send: async (options) => {
      const res = (await base.send(options)) as unknown as { id?: string }
      const id = String(res?.id ?? '')
      if (!id) throw new Error('notification.send: id missing')
      return makeHandle(id)
    },
    remove: (id) => base.remove(id),
    removeGroup: () => base.removeGroup(),
    subscribe: async (id) => {
      await hostApiCall('notification.subscribe', [{ id: String(id) }])
    },
    unsubscribe: async (id) => {
      await hostApiCall('notification.unsubscribe', [{ id: String(id) }])
    },
  }
}

export function PluginView({
  pluginId,
  entry = 'default',
  remoteEntryUrl,
  fallback,
  className,
  componentProps,
}: PluginViewProps) {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null)
  const [error, setError] = React.useState<Error | null>(null)
  const [notInstalled, setNotInstalled] = React.useState(false)
  const [reloadTick, setReloadTick] = React.useState(0)
  const apiRef = React.useRef<PluginApi | null>(null)

  // dev 插件热重载：监听主进程产物变更广播（pluginId 匹配 + UI 变更 → cache-bust 重载）。
  React.useEffect(() => {
    if (!window.dlient?.on) return
    return window.dlient.on('plugin-changed', ({ pluginId: changedId, scope }) => {
      if (changedId === pluginId && scope === 'ui') setReloadTick((t) => t + 1)
    })
  }, [pluginId, entry, remoteEntryUrl])

  React.useEffect(() => {
    let cancelled = false
    const viewId = genViewId()
    const signKey = genSignKey()
    const sign = createSigner(viewId, pluginId, signKey)

    // 1. 登记视图身份（sign_key 只进 preload 视图数组）
    window.dlient.setView({ viewId, pluginId, signKey })

    // CSS 作用域：预创建 body 级 portal 容器（弹层挂载点；与根容器同 data-plugin，见 plugin-portal.ts）
    const portalContainer = ensurePluginPortalContainer(pluginId)

    // 推送订阅（worker push → 渲染层）；onEvent 与 subscribeLogs 复用同一实现（避免对象字面量内自引用）
    // filterId：跨插件 dev 日志订阅（'<filterId>@dev'），并入签名防篡改（preload 验签重建同一串）
    const subscribeEvent = (name: string, cb: (data: unknown) => void, filterId?: string) => {
      let unsubscribed = false
      const timestamp = Date.now()
      void sign(name, timestamp, filterId).then((signature) => {
        if (unsubscribed) return
        // 注意：payload 必须携带 name —— preload 验签用 subject = method ?? name 重建签名字符串
        const dispose = window.dlient.onEvent(name, cb, { viewId, pluginId, name, filterId, timestamp, signature })
        if (unsubscribed) dispose()
      })
      return () => {
        unsubscribed = true
      }
    }

    // UI 端直连 host-api（docs/guides/ui-host-api.md）：签名 subject = method（preload 验签重建同串），
    // 主进程按 viewId 推导身份，执行走 executeHostApi(channel='ui')。
    const hostApiCall = async (method: string, args: unknown[]) => {
      const timestamp = Date.now()
      const signature = await sign(method, timestamp)
      return window.dlient.hostApi({ viewId, pluginId, method, args, timestamp, signature })
    }

    // 2. 构造绑定本视图的实例 API（organization 由宿主 resolveOrg 异步判定后注入；无组织 → org 层禁用）。
    //    orgPromise 先于 load() 就绪，保证 Component 渲染时 apiRef.current 已含 organization。
    const orgPromise: Promise<string | undefined> =
      typeof window.dlient?.getPluginOrg === 'function'
        ? window.dlient.getPluginOrg(pluginId).then((org) => org ?? undefined).catch(() => undefined)
        : Promise.resolve(undefined)
    orgPromise.then((organization) => {
      if (cancelled) return
      const hostProxy = createHostApiProxy((method, args) => hostApiCall(method, args))
      apiRef.current = {
        // api.xxx.xxx：UI 端直连 host-api 开放子集（fs/net/dialog/app/...，child.* 等不开放）
        ...hostProxy,
        // api.notification：句柄特型（send 返回句柄；事件经 'notification-event' 订阅回推，与 worker 侧语义一致）
        notification: createUiNotificationModule(hostProxy.notification, subscribeEvent, hostApiCall),
        pluginId,
        organization,
        request: async <T = unknown,>(method: string, args?: unknown[], opts?: RequestOptions): Promise<ApiResponse<T>> => {
          // 跨插件签名：subject = target_plugin_id|method（preload 验签用同一规则重建）
          const targetPluginId = opts?.plugin
          const subject = targetPluginId ? `${targetPluginId}|${method}` : method
          const timestamp = Date.now()
          const signature = await sign(subject, timestamp)
          return window.dlient.request({
            viewId,
            pluginId,
            method,
            args: args ?? [],
            targetPluginId,
            data: opts?.data,
            timestamp,
            signature,
          }) as Promise<ApiResponse<T>>
        },
        listen: (method, args, listener, opts) => {
          const targetPluginId = opts?.plugin
          const subject = targetPluginId ? `${targetPluginId}|${method}` : method
          const timestamp = Date.now()
          const aborted = { value: false }
          let real: ListenController | null = null
          // 签名异步完成前先返回代理控制器；abort 语义由真实控制器接管
          void sign(subject, timestamp)
            .then((signature) => {
              if (aborted.value) return
              real = window.dlient.listen(
                {
                  viewId,
                  pluginId,
                  method,
                  args: args ?? [],
                  targetPluginId,
                  data: opts?.data,
                  timestamp,
                  signature,
                },
                (chunk, data) => listener(chunk, data),
              )
              if (aborted.value) real?.abort()
            })
            .catch(() => undefined)
          return {
            abort: () => {
              aborted.value = true
              real?.abort()
            },
            signal: {
              get aborted() {
                return aborted.value || (real ? real.signal.aborted : false)
              },
              addEventListener: (cb) => (real ? real.signal.addEventListener(cb) : (() => {}) as () => void),
            },
          }
        },
        onEvent: (name, cb) => subscribeEvent(name, cb),
        readPluginLogs: async (options) => {
          const filterId = typeof options?.filterId === 'string' && options.filterId ? String(options.filterId) : undefined
          const timestamp = Date.now()
          const signature = await sign('read-logs', timestamp, filterId)
          return window.dlient.readPluginLogs({ viewId, pluginId, filterId, options, timestamp, signature })
        },
        subscribeLogs: (cb, filterId) => {
          // filterId 非空 = 跨插件订阅 dev 插件 '<filterId>@dev' 日志（宿主按目标分桶推送）；
          // 渲染层防御性过滤（推送载荷 pluginId 为 '<filterId>@dev'）
          return subscribeEvent(
            'plugin-log',
            (data) => {
              const d = (data ?? {}) as { pluginId?: string; line?: string }
              if (filterId && d.pluginId !== `${filterId}@dev`) return
              const line = String(d.line ?? '')
              if (!line) return
              cb?.({ pluginId: String(d.pluginId ?? pluginId), line })
            },
            filterId,
          )
        },
        clearLogs: async (filterId) => {
          const fid = typeof filterId === 'string' && filterId ? String(filterId) : undefined
          const timestamp = Date.now()
          const signature = await sign('clear-logs', timestamp, fid)
          return window.dlient.clearLogs({ viewId, pluginId, filterId: fid, timestamp, signature })
        },
        requestPermissions: async (capabilities: string[]): Promise<ApiResponse<PermissionResult>> => {
          // 签名 subject='request-permissions'（preload 验签用 name 重建）
          const timestamp = Date.now()
          const signature = await sign('request-permissions', timestamp)
          return window.dlient.requestPermissions({
            viewId,
            pluginId,
            capabilities: Array.isArray(capabilities) ? capabilities : [],
            timestamp,
            signature,
          }) as Promise<ApiResponse<PermissionResult>>
        },
        // api.modal：命令式弹框（@dlient-open/ui 渲染层能力，非 host-api）。自动绑定本视图 api——
        // 插件直接 api.modal.confirm(...) / api.modal.dialog(...)，弹框内容自动包进
        // PluginApiContext + 插件 CSS 作用域（scopeId 由 api.pluginId 推导），无需手动传 options.api。
        // 类型经 ui 包对 PluginApi 的模块增补提供（plugin-api.augment.ts）。
        modal: {
          info: (options?: ModalOptions) => uiModal.info({ ...options, api: apiRef.current! }),
          success: (options?: ModalOptions) => uiModal.success({ ...options, api: apiRef.current! }),
          warn: (options?: ModalOptions) => uiModal.warn({ ...options, api: apiRef.current! }),
          error: (options?: ModalOptions) => uiModal.error({ ...options, api: apiRef.current! }),
          delete: (options?: ModalOptions) => uiModal.delete({ ...options, api: apiRef.current! }),
          confirm: (options?: ModalOptions) => uiModal.confirm({ ...options, api: apiRef.current! }),
          dialog: (options?: DialogOptions) => uiModal.dialog({ ...options, api: apiRef.current! }),
          sync: uiModal.sync,
        },
      }
      return load()
    })

    async function load() {
      try {
        // 加载前判定插件是否已安装：未安装给出明确提示（而非 dlientV3:// 协议 404 报错）。
        // dev 实例（'<id>@dev'）豁免：dev 插件不进已安装清单（F2：只在 dev runtime 打开），
        // 由 dev runtime 保证其存在，跳过已安装检查。
        const isDevInstance = pluginId.endsWith('@dev')
        if (!isDevInstance && typeof window.dlient?.listInstalledPlugins === 'function') {
          const installed = await window.dlient.listInstalledPlugins()
          const installedIds = new Set((installed ?? []).map((p) => p.id))
          if (!installedIds.has(pluginId)) {
            if (!cancelled) setNotInstalled(true)
            return
          }
        }
        if (!cancelled) setNotInstalled(false)
        const mod = await loadPluginRemote(pluginId, remoteEntryUrl, reloadTick)
        // entry 指定渲染的导出名；默认取 default，兼容历史命名导出 Plugin
        const Comp = extractEntry(mod, entry)
        if (!Comp) {
          throw new Error(`Plugin "${pluginId}" has no export "${entry}"`)
        }
        if (!cancelled) setComponent(() => Comp)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      }
    }

    return () => {
      cancelled = true
      // 卸载时注销视图身份：主进程回收 view 登记与订阅，preload 清除 sign_key 表
      window.dlient?.unsetView?.(viewId)
      // portal 容器清理：仅当空（该视图弹层已随卸载关闭）才移除，避免误伤同插件其它视图的容器
      if (portalContainer && portalContainer.childElementCount === 0) portalContainer.remove()
    }
  }, [pluginId, entry, remoteEntryUrl, reloadTick])

  if (error) {
    return fallback || (
      <Empty className="dui:py-10">
        <Alert variant="destructive" className="dui:max-w-sm">
          <AlertTitle>{`Failed to load plugin "${pluginId}"`}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </Empty>
    )
  }

  if (notInstalled) {
    return fallback || (
      <Empty
        title={`Plugin "${pluginId}" is not installed.`}
        description="请先安装该插件后再打开。"
        className="dui:py-10"
      />
    )
  }

  if (!Component) {
    return (
      <div
        className={cn('dui:flex dui:items-center dui:justify-center dui:py-8', className || '')}
        style={{ height: '100%' }}
      >
        <Spinner className="dui:size-5" />
      </div>
    )
  }

  const Inner = Component as React.ComponentType<Record<string, unknown>>
  return (
    // CSS 作用域锚点：data-plugin 与构建期 PostCSS 前缀选择器对齐（见 docs/specs/plugin-css-scope.md）；
    // 弹层走 body 级 portal 容器（ensurePluginPortalContainer），同属性同作用域。
    <div className={className || undefined} style={{ height: '100%' }} data-plugin={pluginScopeId(pluginId)}>
      {/* apiRef.current 在上方 effect 中与 load() 同步赋值，且 Component 为空时已提前 return，
          因此能走到这里说明 load 已完成 → ref 必已就绪。改用 state 会为每个视图多一次渲染，
          且 api 对象含 sign_key 闭包，不宜进入 state 参与比较。 */}
      {/* eslint-disable-next-line react-hooks/refs */}
      <PluginApiContext.Provider value={apiRef.current}>
        <Inner {...(componentProps ?? {})} />
      </PluginApiContext.Provider>
    </div>
  )
}
