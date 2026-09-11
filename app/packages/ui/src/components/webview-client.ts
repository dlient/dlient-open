/**
 * webview-client.ts - 绑定到「当前视图」的 webview 直连客户端。
 *
 * 由 PluginView 挂载时创建（持有 view_id / plugin_id / 签名器 sign），经 WebviewClientContext 注入子树；
 * ui 包的 <Webview> 组件从 context 取用。调用链：
 *   client.create(...) → window.dlient.webview.create({ viewId, pluginId, timestamp, signature, ... })
 *                      → preload 验签（视图身份 + HMAC）
 *                      → 主进程 webview-ipc（按「创建者视图」校验归属）→ webview-manager → WebContentsView
 *
 * 与旧实现（host-api webview.*，经插件 worker 中转）相比：不再依赖 manifest 的 webview 权限，
 * 也不再受 worker 存活/转发时序影响；webview 的创建与回收只认「视图身份」。
 * webContents 事件不经此对象：主进程按创建者视图推送 'webview:event'，用 api.onEvent 订阅。
 */
import { createContext, useContext } from 'react'

export interface WebviewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 直连调用的统一返回信封（与 preload 的 webview.* 一致） */
export interface WebviewCallResult<T = unknown> {
  code: number
  msg?: unknown
  data: T | null
}

export interface WebviewClient {
  create(opts: {
    src: string
    bounds: WebviewBounds
    webPreferences?: Record<string, unknown>
    events?: string[]
  }): Promise<WebviewCallResult<{ viewId: string }>>
  update(webviewId: string, bounds: WebviewBounds): Promise<WebviewCallResult<null>>
  destroy(webviewId: string): Promise<WebviewCallResult<null>>
  setVisible(webviewId: string, visible: boolean): Promise<WebviewCallResult<null>>
  call<T = unknown>(webviewId: string, method: string, args?: unknown[]): Promise<WebviewCallResult<T>>
  /** 隐藏本插件归属的全部 webview，返回本次隐藏的 id 列表 */
  hideMine(): Promise<WebviewCallResult<string[]>>
  /** 显示本插件归属的 webview；views 传入时只恢复列表内的那些 */
  showMine(views?: string[]): Promise<WebviewCallResult<null>>
}

/** webview 客户端上下文（PluginView 注入；组件不在 PluginView 内时为 null） */
export const WebviewClientContext = createContext<WebviewClient | null>(null)

/** 取当前视图的 webview 客户端（不在 PluginView 子树内时返回 null） */
export function useWebviewClient(): WebviewClient | null {
  return useContext(WebviewClientContext)
}

/** 主世界可见的 preload 直连接口（类型由宿主 electron-env.d.ts 声明，这里用结构断言避免跨包类型耦合） */
type DlientWebviewBridge = Record<string, ((payload: unknown) => Promise<unknown>) | undefined>

function bridge(): DlientWebviewBridge | undefined {
  return (window as unknown as { dlient?: { webview?: DlientWebviewBridge } }).dlient?.webview
}

/** 创建绑定当前视图的客户端（sign：对 `webview:<method>` 主题做视图签名） */
export function createWebviewClient(bridgeInfo: {
  viewId: string
  pluginId: string
  sign: (subject: string, timestamp: number) => Promise<string>
}): WebviewClient {
  const invoke = async <T,>(method: string, extra: Record<string, unknown>): Promise<WebviewCallResult<T>> => {
    const api = bridge()
    const fn = api?.[method]
    if (typeof fn !== 'function') {
      return { code: -32601, msg: 'webview bridge unavailable', data: null }
    }
    const timestamp = Date.now()
    const signature = await bridgeInfo.sign(`webview:${method}`, timestamp)
    return (await fn({
      viewId: bridgeInfo.viewId,
      pluginId: bridgeInfo.pluginId,
      timestamp,
      signature,
      ...extra,
    })) as WebviewCallResult<T>
  }

  return {
    create: (opts) => invoke('create', opts),
    update: (webviewId, bounds) => invoke('update', { webviewId, bounds }),
    destroy: (webviewId) => invoke('destroy', { webviewId }),
    setVisible: (webviewId, visible) => invoke('setVisible', { webviewId, visible }),
    call: (webviewId, method, args) => invoke('call', { webviewId, method, args }),
    hideMine: () => invoke('hideMine', {}),
    showMine: (views) => invoke('showMine', { views }),
  }
}
