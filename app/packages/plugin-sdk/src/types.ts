/**
 * 领域模型：PluginManifest / PluginPermission / PluginRuntime / PluginInstalled / PluginType。
 * manifest 对应插件 package.json 的 `dlient` 子对象。
 * 该文件是类型与工具函数的事实来源（自 core 迁入），core 反向引用本包。
 */

/** 本地化文案：字符串（默认值）或多语言映射（键为 locale，如 'zh-CN'/'en-US'；'default' 键兜底） */
export type LocalizedText = string | Record<string, string>

/**
 * expose 方法调用权限（docs/v3/plugin-view.md §2.2）：
 *  - private           仅本插件自己；
 *  - default（缺省）   宿主（主进程侧）+ 本插件自己；
 *  - system            system 插件可默认调用，非 system 插件不可调；
 *  - public            所有插件，无需 dependencies 声明；
 *  - install-confirm   安装时用户确认（永久有效），须在 dependencies 中声明；
 *  - runtime-confirm   使用时用户确认（1 天内有效），须在 dependencies 中声明。
 * 支持组合表达式：'|' = 或（满足任一），'&' = 且（需全部满足）。
 * 例：`runtime-confirm | system` = system 直接调用，其它插件需运行时确认。
 */
export type ExposeAccess =
  | 'private'
  | 'default'
  | 'system'
  | 'public'
  | 'install-confirm'
  | 'runtime-confirm'

/** expose 方法条目 */
export interface PluginExposeMethod {
  /** 方法说明（确认框 / 上传校验文案用） */
  description?: string
  /** 调用权限表达式（缺省 'default'） */
  access?: string
  /**
   * 参数结构 JSON Schema（可选，仅描述用途）：
   * 描述该方法入参的 JSON Schema 对象（如 { type:'object', properties:{...} }），
   * 供调用方文档 / 表单生成 / 市场展示参考。宿主 plugin.invoke 不做运行时校验。
   */
  paramsSchema?: Record<string, unknown>
}

export interface PluginManifest {
  id: string                          // 插件唯一 ID
  version: string                     // semver
  /** 显示名：字符串或多语言映射（键为 locale，如 'zh-CN'/'en-US'；'default' 兜底） */
  name: LocalizedText
  /** 描述：**必填**。字符串或多语言映射（同上） */
  description: LocalizedText
  /** dist 目录相对插件根目录的路径（默认 'dist'；开发插件可为任意外部目录的构建输出） */
  dist?: string
  /**
   * 插件类型：
   *  - app（**缺省**）：独立应用，可在基座中直接启动（启动后打开页面）；
   *  - full / worker / ui：提供能力给其它插件调用的常规插件。
   * 缺省 'app'。
   */
  type?: PluginType
  /** 是否为系统级插件（不可卸载；基座首次启动时从服务器下载并安装） */
  system?: boolean
  /** 来源：market=市场；local=本地；dev=开发中（缺省由加载上下文决定） */
  source?: PluginSource
  /**
   * worker 运行模式：
   *  - 'shared'（缺省）：与其他插件共享进程池（按类型分池，每池 ≤8）；
   *  - 'solo'：独占单 worker 池（一插件一池一进程，不与其他插件共享；崩溃/阻塞只影响自己）。
   *  dev 插件（source==='dev'）无论此字段如何都强制走 solo 池。
   */
  workerMode?: 'shared' | 'solo'
  /**
   * 图标：**必填**。相对插件根目录路径字符串（如 "assets/icon.svg" / "assets/icon.png"）。
   * 渲染层统一以 <img> 原色展示。
   */
  icon: string
  /** 搜索 API（预留）：提供给搜索插件调用，搜索插件传入关键词，插件返回搜索结果 */
  search_api?: string
  /** 插件标签（市场展示 / 检索；如 ["ai", "chat"]） */
  tags?: string[]
  /** 所属组织（组织标识，形如 "@xxx"） */
  organization?: string
  requires?: string[]                 // 依赖的插件 ID
  platforms?: PluginPlatform[]        // 支持平台（缺省=全平台）
  /**
   * 是否包含原生模块（.node 二进制，经 @electron/rebuild 针对 Electron ABI 编译）。
   * true 时必须同时声明 platforms（原生模块为平台二进制，仅允许在声明的平台上下载安装），
   * 且产物中必须实际包含 .node 文件（服务端上传时校验二者一致性）。
   * 与 nativeModules 二选一：native=dist 内携带 .node；nativeModules=用户侧经 npm 安装。
   */
  native?: boolean
  /**
   * 原生模块按用户侧安装（docs/todo/16-native-host.md）：
   * 构建时外部化（external）不打包，上传包不含 .node / node_modules；
   * 用户下载后经 npm 安装到插件目录 node_modules，由独立官方 Node 子进程（native-host）加载。
   * 声明后 dist 内不得含 .node（服务端上传校验），且不得与 native 同时声明。
   */
  nativeModules?: PluginNativeModules
  /**
   * 最低要求的 Node.js 版本（如 "22"，也支持 ">=22" / "22.11" 形式）。
   * 运行时/安装前（nodejs.resolveRuntime / NodeInstall）按此校验本机与内置 node：
   * 都不满足时自动安装宿主托管的官方 Node（最新 LTS）。不声明则不做版本门槛。
   */
  nodeVersion?: string
  permissions?: PluginPermission[]    // 申请的宿主能力
  /**
   * 文件系统目录声明（别名或绝对路径；安装时用户确认）。
   * read 与 write 分开声明（能读 ≠ 能写）；别名见 docs/specs/plugin-permission.md §4.2。
   */
  fsDirs?: { read?: string[]; write?: string[] }
  /** spawn 命令声明（可执行文件绝对路径、basename 或命令别名；安装时用户确认；系统二进制默认禁止）。
   *  别名（CMD_NODE / CMD_NPM / CMD_NPX / CMD_PNPM，见 ./cmd-alias）由宿主解析为真实可执行文件，
   *  并按别名记账——换机器 / 换 node 版本不重弹；其它字符串按原样做命令匹配。
   *  F9：string=仅命令（参数不限）；{ cmd, argsPattern }=命令 + 参数约束（逐参数正则、锚定、长度上限）。解释器建议对象规则。 */
  spawnCmds?: (string | { cmd: string; argsPattern?: string })[]
  /** 对外暴露给其它插件调用的方法（plugin.invoke 校验；access 见 ExposeAccess） */
  expose?: Record<string, PluginExposeMethod>
  /** 声明要调用的其它插件方法（plugin.invoke 校验） */
  dependencies?: Record<string, string[]>
  engines?: {
    dlient?: string
    electron?: string
  }
  author?: string
  homepage?: string
  repository?: string
}

/**
 * 目标平台 + 架构组合（共 6 个）：win32.x64 / win32.arm64 / darwin.x64 / darwin.arm64 / linux.x64 / linux.arm64。
 * dev-tools 设置页按「平台 × x64/arm64」卡片勾选生成；空数组/缺省 = 全平台。
 * 原生插件（native / nativeModules）按此逐组合分别上传（服务端三元组 (plugin_id, version, platform)）。
 */
export type PluginPlatform = 'win32.x64' | 'win32.arm64' | 'darwin.x64' | 'darwin.arm64' | 'linux.x64' | 'linux.arm64'

/**
 * 用户侧按需安装的原生模块声明（dlient.nativeModules）。
 * 下载安装后，market 在插件目录生成专属 package.json + lockfile，经 `npm ci --omit=dev --prefer-offline`
 * 仅安装声明的原生模块及其传递依赖；运行侧由官方 Node 子进程（native-host）经 createRequire 解析。
 */
export interface PluginNativeModules {
  /** 包名 → 版本（npm install <name>@<version> 精确安装，避免锁漂移；semver 范围亦可） */
  dependencies?: Record<string, string>
  /** 是否必须用 nodejs 插件提供的官方 Node 运行（默认 true；false 表示可用任意 Node 运行时） */
  useBundledNode?: boolean
}

export type PluginPermission =
  | 'webview.create'
  | 'webview.navigate'
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'fs.listDir'
  | 'fs.watch'
  | 'os.openExternal'
  | 'clipboard.read'
  | 'clipboard.write'
  | 'system.getIdleState'
  // app.* 宿主能力
  | 'app.data'               // 插件数据隔离存储（USER_DATA/plugin-data/<pluginId>/）
  | 'app.setAutoLaunch'      // 开机自启动
  | 'app.shortcut.register'  // 快捷键注册
  | 'app.crypt'              // 每插件独立密钥加解密（主进程内部派生，插件间隔离）
  | 'app.window'             // 窗口控制（无头模式自绘标题栏：关闭窗口等）
  | 'app.menu'               // 原生右键菜单（主进程 Menu.popup，返回被点击项 id）
  | 'app.event'              // 转发事件到渲染层（主题 / 语言）
  | 'nativeTheme.system'     // 跟随系统主题（nativeTheme 变化 → 渲染层 theme 通道）
  | 'plugins.dev'            // 开发插件管理（外部目录注册 / 移除 / 热重载）
  | 'plugins.install'        // 插件市场（已安装清单 / 安装 / 卸载，落地主进程）
  | 'child.spawn'            // 宿主代 spawn / execFile（命令白名单 + 运行时授权）

export interface PluginRuntime {
  id: string
  version: string
  /** 实例状态机（生命周期 12.3.5-①）：stopped → starting → running → restarting → running；failed 可重试；stopping 为停止过渡 */
  status: 'stopped' | 'starting' | 'running' | 'restarting' | 'stopping' | 'failed'
  generation: number
  enabled: boolean
  error?: string
  startTime?: number
}

export interface PluginInstalled {
  id: string
  version: string
  installedAt: number
  enabled: boolean
  updateAvailable?: string
}

export type PluginType = 'full' | 'worker' | 'ui' | 'app'

/** 插件来源：market=市场安装；local=本地导入；dev=开发中 */
export type PluginSource = 'market' | 'local' | 'dev'

/** 缺省推断：显式声明优先；未声明按 'app'（独立应用，基座启动器直接打开页面） */
export function inferPluginType(manifest: PluginManifest): PluginType {
  return manifest.type ?? 'app'
}

/** 校验 nativeModules 声明：合法返回 undefined，非法返回错误描述（供服务端上传 / SDK 安装前校验复用） */
export function validateNativeModules(decl: PluginNativeModules | undefined): string | undefined {
  if (!decl) return undefined
  const deps = decl.dependencies
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    return 'nativeModules.dependencies must be a non-empty object'
  }
  const names = Object.keys(deps)
  if (names.length === 0) return 'nativeModules.dependencies must not be empty'
  for (const name of names) {
    const ver = deps[name]
    if (typeof name !== 'string' || name.length === 0) return 'nativeModules.dependencies key must be a non-empty package name'
    if (typeof ver !== 'string' || ver.length === 0) return `nativeModules.dependencies["${name}"] must be a non-empty version string`
    // 防止恶意依赖名逃逸到 shell/路径（npm 包名仅允许 scoped 或 URL 编码字符）
    if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name)) {
      return `nativeModules.dependencies["${name}"] is not a valid npm package name`
    }
  }
  if (decl.useBundledNode !== undefined && typeof decl.useBundledNode !== 'boolean') {
    return 'nativeModules.useBundledNode must be a boolean'
  }
  return undefined
}

/** 解析本地化文案：locale 无匹配时回退 'default' 键 → 字符串本身 → fallback */
export function localizeText(text: LocalizedText | undefined, locale: string, fallback = ''): string {
  if (!text) return fallback
  if (typeof text === 'string') return text
  return text[locale] ?? text['default'] ?? fallback
}
