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

/** webview 直连调用载荷：viewId = 调用者视图身份（preload 按 viewId + HMAC 验签；subject = 'webview:create' 等） */
interface DlientWebviewPayload {
  viewId: string
  pluginId: string
  timestamp: number
  signature: string
}

/** webview 直连统一返回信封（data 为各方法结果） */
interface DlientWebviewResult<T = unknown> {
  code: number
  msg?: unknown
  data: T | null
}

/** 元素边界（webview 位置/尺寸，CSS 像素） */
interface DlientWebviewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** preload 暴露的渲染层桥：setView / request / listen / onEvent（签名机制）+ on（广播订阅） */
interface DlientBridge {
  /**
   * 渲染层直连 WebContentsView（替代原 host-api 的 webview.*；插件无需在 manifest 声明 webview 权限）。
   * 约束：只有「创建该 webview 的视图」能操作它；沙箱与 webPreferences/webContents 方法/事件三类白名单仍在主进程。
   */
  webview: {
    create(
      payload: DlientWebviewPayload & {
        src: string
        bounds: DlientWebviewBounds
        webPreferences?: Record<string, unknown>
        events?: string[]
      },
    ): Promise<DlientWebviewResult<{ viewId: string }>>
    update(payload: DlientWebviewPayload & { webviewId: string; bounds: DlientWebviewBounds }): Promise<DlientWebviewResult<null>>
    destroy(payload: DlientWebviewPayload & { webviewId: string }): Promise<DlientWebviewResult<null>>
    setVisible(payload: DlientWebviewPayload & { webviewId: string; visible: boolean }): Promise<DlientWebviewResult<null>>
    call<T = unknown>(
      payload: DlientWebviewPayload & { webviewId: string; method: string; args?: unknown[] },
    ): Promise<DlientWebviewResult<T>>
    /** 隐藏本插件归属的全部 webview，返回本次隐藏的 webview id 列表 */
    hideMine(payload: DlientWebviewPayload): Promise<DlientWebviewResult<string[]>>
    /** 显示本插件归属的 webview；views 传入时只恢复列表内的那些 */
    showMine(payload: DlientWebviewPayload & { views?: string[] }): Promise<DlientWebviewResult<null>>
  }
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
     * filePath 为空则弹系统文件选择框；传入路径（如拖入的文件）则直接解析该文件。
     * 返回 { ok: true, preview } | { ok: false, error } | null
     */
    previewImportPlugin(filePath?: string): Promise<{
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
    /** 拖入文件取真实路径（Electron 32+ 已移除 File.path，须在 preload 用 webUtils 解析） */
    getPathForFile(file: File): string
    /**
     * npm / github / 网址 导入：解析源 → 拉取 .dlient 临时文件并解析 manifest（不落盘）。
     * 返回 { ok: true, token, kind, source, preview } | { ok: false, error }；token 供确认安装 / 取消清理。
     */
    previewImportSource(source: string): Promise<
      | {
          ok: true
          token: string
          kind: 'npm' | 'github' | 'url'
          source: string
          preview: {
            id: string
            name: string
            version: string
            type?: string
            description?: string
            permissions: Array<{ key: string; level: string; description?: { 'zh-CN': string; 'en-US': string } | null }>
            preInstall: Array<{ id: string; source: string; kind: 'npm' | 'github' | 'url' }>
          }
        }
      | { ok: false; error: string }
    >
    /** 按预览 token 安装（复用深度安装核心；成功即清理临时文件，失败保留以便重试） */
    installImportSource(token: string): Promise<{ ok: boolean; id?: string; name?: string; version?: string; error?: string }>
    /** 取消导入 / 关闭确认框：清理预览临时文件 */
    discardImportSource(token: string): Promise<void>
    /**
     * 操作台 NPM 市场：按关键词 dlient-open-plugin 搜索 npm（main 直连 registry）。
     * sort：downloads=按下载量（popularity 权重）/ date=按发布时间（本地排）；
     * kind（app/plugin）与 tag（分类 key）作为检索关键词加入；返回已富化（含 dlient 元数据）的有效插件。
     */
    searchNpmMarket(opts: {
      q?: string
      sort?: 'downloads' | 'date'
      kind?: 'all' | 'app' | 'plugin'
      tag?: string
      from?: number
      size?: number
    }): Promise<
      | {
          ok: true
          total: number
          hasMore: boolean
          items: Array<{
            name: string
            title?: unknown
            id: string
            version: string
            type: 'app' | 'plugin'
            description?: unknown
            date: string
          }>
        }
      | { ok: false; error: string }
    >
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
