/**
 * 宿主 preload 注入的渲染层桥类型（与 app/src/preload/electron-env.d.ts 对齐）。
 * ui 包独立构建（tsc 生成声明）时自带该类型，不依赖宿主源码。
 */

/** 主进程广播事件载荷（on() 通道，仅保留 ui 包用到的） */
interface DlientBroadcastEventMap {
  /** dev 插件产物变更（PluginView 据此 cache-bust 重载） */
  'plugin-changed': { pluginId: string; scope: 'ui' | 'worker'; ts: number }
  /** NOTIFY 事件通知（宿主 → 渲染层；receiver 定向匹配） */
  'notify': {
    event: string
    event_id: string
    receiver: string[]
    data?: unknown
    from?: string
  }
}

/** listen 返回的取消控制器（abort() 向 worker 发 cancel） */
interface DlientListenController {
  abort(): void
  readonly signal: {
    readonly aborted: boolean
    addEventListener(cb: () => void): () => void
  }
}

/** preload 暴露的渲染层桥：setView / request / listen / onEvent（签名机制）+ on（广播订阅） */
interface DlientBridge {
  /** PluginView 挂载时登记视图身份（view_id / plugin_id / sign_key） */
  setView(view: { viewId: string; pluginId: string; signKey: string }): void
  /** PluginView 卸载时注销视图身份（view_id） */
  unsetView(viewId: string): void
  /** 渲染层页面已就绪（宿主壳 mounted）：主进程据此启动核心插件引导流程 */
  rendererReady(): void
  /** 带签名的方法调用：直连目标 worker（target_plugin_id 缺省 = 自调用）；subject = method 或 target_plugin_id|method */
  request(payload: {
    viewId: string
    pluginId: string
    method: string
    args?: unknown[]
    /** 跨插件目标插件 id（缺省连自己的 worker） */
    targetPluginId?: string
    /** 大块数据（ArrayBuffer，transfer 零拷贝） */
    data?: ArrayBuffer
    timestamp: number
    signature: string
  }): Promise<unknown>
  /** 带签名的流式请求：listener 逐块回调，返回 { abort, signal } 控制器 */
  listen(
    payload: {
      viewId: string
      pluginId: string
      method: string
      args?: unknown[]
      targetPluginId?: string
      data?: ArrayBuffer
      timestamp: number
      signature: string
    },
    listener: (chunk: unknown, data?: ArrayBuffer) => void,
  ): DlientListenController
  /** 带签名的推送订阅（worker 推送），返回取消订阅函数；filterId 非空 = 跨插件订阅 dev 插件 '<filterId>@dev' 日志（并入签名） */
  onEvent(
    name: string,
    callback: (data: unknown) => void,
    payload: {
      viewId: string
      pluginId: string
      name: string
      filterId?: string
      timestamp: number
      signature: string
    },
  ): () => void
  /** 监听主进程广播事件（on() 白名单通道），返回取消订阅函数 */
  on<K extends keyof DlientBroadcastEventMap>(channel: K, callback: (data: DlientBroadcastEventMap[K]) => void): () => void
  /** 已安装插件清单（含 id / type 等，PluginView 据此判断插件是否已安装） */
  listInstalledPlugins(): Promise<Array<{ id: string; type?: string }>>
  /** 解析插件组织标识（'@xxx'；宿主主进程 resolveOrg 判定，未登录/篡改/无组织 → null） */
  getPluginOrg(pluginId: string): Promise<string | null>
  /** 插件 UI 直写日志（签名 subject='log'；主进程按视图身份推导插件日志目录） */
  log(payload: {
    viewId: string
    pluginId: string
    level: string
    message: string
    data?: unknown
    timestamp: number
    signature: string
  }): Promise<void>
  /** 读取插件日志（增量 tail：签名 subject='read-logs'；主进程记账只回传新增行）。filterId 非空 = 跨插件读 '<filterId>@dev' */
  readPluginLogs(payload: {
    viewId: string
    pluginId: string
    filterId?: string
    options?: { offset?: number; maxBytes?: number }
    timestamp: number
    signature: string
  }): Promise<{ lines: string[]; offset: number; reset: boolean; truncated: boolean }>
  /** 清空插件日志（签名 subject='clear-logs'）。filterId 非空 = 跨插件清 '<filterId>@dev' */
  clearLogs(payload: {
    viewId: string
    pluginId: string
    filterId?: string
    timestamp: number
    signature: string
  }): Promise<unknown>
  /** 批量申请跨插件能力（'pluginId.method' 数组；签名 subject='request-permissions'），返回 { granted, denied } */
  requestPermissions(payload: {
    viewId: string
    pluginId: string
    capabilities: string[]
    timestamp: number
    signature: string
  }): Promise<unknown>
  /** UI 端直连 host-api（docs/guides/ui-host-api.md）：签名 subject = method；执行走 executeHostApi(channel='ui'） */
  hostApi(payload: {
    viewId: string
    pluginId: string
    method: string
    args?: unknown[]
    timestamp: number
    signature: string
  }): Promise<unknown>
}

interface Window {
  dlient: DlientBridge
}
