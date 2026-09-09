/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /** The built directory structure */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

/** 宿主壳可启动的 app 插件（type === 'app'，layout 经 worker host-api 获取） */
interface AppPluginInfo {
  id: string
  /** 本地化名称 */
  name: string
  /** 图标：相对路径字符串（svg/png），相对 dlientOpen://plugin/<id>/ */
  icon?: string
  /** 是否为系统级插件 */
  system?: boolean
}

/** 已安装插件清单条目（layout 侧边栏 / 市场等只读用途） */
interface InstalledPluginInfo {
  id: string
  name: string
  version: string
  type: 'full' | 'worker' | 'ui' | 'app'
  source: 'market' | 'local' | 'dev'
  system?: boolean
  icon?: string
  description?: string
  /** 多语言名称（主进程 listInstalled 由 manifest 解析，LocalizedText：对象 / JSON 字符串） */
  nameL10n?: unknown
  /** 多语言描述（同上） */
  descriptionL10n?: unknown
  /** 依赖插件 id 列表（manifest dlient.dependencies 的键） */
  dependencies?: string[]
  /** dist 是否含可加载产物（remoteEntry.js / worker.js 至少其一；dev 插件可能未打包） */
  hasDist?: boolean
}

/** 主进程广播事件载荷（on() 通道） */
interface DlientBroadcastEventMap {
  /** 核心插件加载完成（基座壳据此加载 layout 主界面） */
  'plugins-ready': void
  /** 核心插件引导进度（宿主壳启动页据此更新提示） */
  'startup-progress': { stage: 'checking' | 'downloading' | 'installing' | 'starting' | 'ready' | 'network-error'; detail?: string }
  /** dev 插件产物变更（PluginView 据此 cache-bust 重载） */
  'plugin-changed': { pluginId: string; scope: 'ui' | 'worker'; ts: number }
  /** 插件实例状态变更（{ runtime: PluginRuntime }，生命周期 12.3.5-① 广播） */
  'plugin-status-changed': { runtime: { id: string; version: string; status: string; generation: number; enabled: boolean; error?: string; startTime?: number } }
  /** 窗口最大化状态变化（自绘标题栏切换 最大化/还原 图标） */
  'window-state': { maximized: boolean }
  /** 主题变化（setting 插件 app.event 转发 / system 跟随 OS；REPLAY 回放初始值） */
  'theme': 'dark' | 'light'
  /** 语言变化（setting 插件 app.event 转发；REPLAY 回放初始值） */
  'language': 'zh-CN' | 'en-US'
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
  /** 启动重试（非 dev 离线缺核心插件时，用户点「重试」重新走比较流程） */
  retryStartup(): void
  /** 查询已安装插件清单（PluginView 加载前判定插件是否已安装；只读） */
  listInstalledPlugins(): Promise<InstalledPluginInfo[]>
  /** 解析插件组织标识（'@xxx'；宿主主进程 resolveOrg 判定，未登录/篡改/无组织 → null） */
  getPluginOrg(pluginId: string): Promise<string | null>
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
  /** 内置宿主壳首方通道（layout / setting 并入宿主后使用；宿主壳为可信首方 UI，无插件授权语义） */
  hostShell: {
    windowClose(): Promise<void>
    windowMinimize(): Promise<void>
    windowMaximize(): Promise<void>
    windowUnmaximize(): Promise<void>
    windowRestore(): Promise<void>
    windowSetFullScreen(flag: boolean): Promise<void>
    windowIsMaximized(): Promise<boolean>
    menuPopup(opts: unknown): Promise<string | null>
    /** 打开外部浏览器（导入依赖 tab 查看 npm / github 用） */
    openExternal(url: string): Promise<void>
    /** 监听宿主「plugin.install 用户确认」请求；返回取消订阅函数 */
    onPluginInstallConfirm(
      cb: (data: { confirmId: string; payload: { id: string; kind: 'file' | 'npm' | 'github' | 'url'; source: string; description: string } }) => void,
    ): () => void
    /** 回传 plugin.install 确认结果（true = 用户确认安装） */
    confirmPluginInstall(confirmId: string, ok: boolean): Promise<void>
    setActiveApp(pluginId: string | null): Promise<void>
    listPlugins(): Promise<InstalledPluginInfo[]>
    /** 校验插件包完整性（本地签名）；失败返回 { ok:false, reason:'integrity' }（@dev 恒 ok） */
    verifyPlugin(pluginId: string): Promise<{ ok: boolean; reason?: string; error?: string }>
    checkReadiness(
      pluginId: string,
      manifest?: { dependencies?: unknown; preInstall?: unknown; nodeVersion?: unknown },
    ): Promise<{
      ready: boolean
      missingDeps: string[]
      nodejsMissing: boolean
      nodejsOutdated: boolean
      nodeVersion?: string
    }>
    nodejsStatus(opts?: { version?: string }): Promise<{
      ready: boolean
      bundled: { ready: boolean; version?: string; satisfies?: boolean }
      local: { hasNode: boolean; version?: string; satisfies?: boolean }
      satisfies: boolean
    }>
    nodejsInstall(version?: string): Promise<{ ok: boolean; version?: string; path?: string; error?: string }>
    nodejsProgress(): Promise<unknown>
    /**
     * 选择并解析 .dlient（不落盘）：返回插件信息与权限清单供用户确认；文件选择取消返回 null。
     * 返回 { ok: true, preview } | { ok: false, error } | null
     */
    previewImportPlugin(): Promise<{
      ok: boolean
      error?: string
      preview?: {
        filePath: string
        id: string
        name: string
        version: string
        type?: string
        description?: string
        permissions: Array<{ key: string; level: string; description?: { 'zh-CN': string; 'en-US': string } | null }>
        preInstall: Array<{ id: string; source: string; kind: 'npm' | 'github' | 'url' }>
      }
    } | null>
    /** 确认导入（解包落盘 → 注册表 → 广播）；filePath 来自 previewImportPlugin 返回的 preview.filePath */
    confirmImportPlugin(filePath: string): Promise<{ ok: boolean; id?: string; name?: string; version?: string; error?: string }>
    uninstallPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }>
    settingsGet(): Promise<{
      language?: 'zh-CN' | 'en-US'
      theme?: 'light' | 'dark' | 'system'
      autoLaunch?: boolean
      shortcuts?: Record<string, string>
    }>
    settingsSet(partial: {
      language?: 'zh-CN' | 'en-US'
      theme?: 'light' | 'dark' | 'system'
      autoLaunch?: boolean
      shortcuts?: Record<string, string>
    }): Promise<unknown>
    about(): Promise<{ name: string; version: string; locale: string; platform: string }>
  }
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
  /** 宿主壳全局捕获的未处理前端错误上报（宿主渲染层自身调用；主进程从栈解析插件归属 + 白名单校验后才写日志） */
  reportCapturedError(payload: { kind: 'error' | 'unhandledrejection'; message: string; stack?: string }): void
}

// Used in Renderer process, exposed in preload
interface Window {
  dlient: DlientBridge
}
