/**
 * HostCapabilities - 能力注册 + 按插件授权（host-api 唯一裁决）。
 */

import type { PluginPermission } from '@dlient-open/plugin-sdk'

/** 能力说明（多语言：渲染层按当前 locale 取对应文案） */
export interface HostCapabilityDescription {
  'zh-CN': string
  'en-US': string
  /** 其它语言兜底（缺省取 en-US） */
  default?: string
}

export interface HostCapability {
  id: string
  name: string
  /** 权限说明（中英文；渲染层按 locale 显示） */
  description: HostCapabilityDescription
  /** 来源限制：marketplace=市场插件可用；self-hosted=自托管可用；all=全部 */
  allowedFor: 'market' | 'local' | 'all'
}

/** 内置能力清单（单一数据源；运行实例与导出函数共用） */
const DEFAULT_CAPABILITIES: HostCapability[] = [
  { id: 'webview.create', name: 'Create WebView', description: { 'zh-CN': '创建网页视图（WebContentsView）', 'en-US': 'Create WebContentsView' }, allowedFor: 'all' },
  { id: 'webview.navigate', name: 'Navigate WebView', description: { 'zh-CN': '将网页视图导航到指定 URL', 'en-US': 'Navigate webview to URL' }, allowedFor: 'all' },
  { id: 'fs.read', name: 'Read Files', description: { 'zh-CN': '读取文件（文件系统）', 'en-US': 'Read files from filesystem' }, allowedFor: 'all' },
  { id: 'fs.write', name: 'Write Files', description: { 'zh-CN': '写入文件（文件系统）', 'en-US': 'Write files to filesystem' }, allowedFor: 'all' },
  { id: 'fs.delete', name: 'Delete Files', description: { 'zh-CN': '删除文件 / 目录', 'en-US': 'Delete files/directories' }, allowedFor: 'all' },
  { id: 'fs.listDir', name: 'List Directory', description: { 'zh-CN': '枚举目录条目（含 stat 信息）', 'en-US': 'Enumerate directory entries (with stat)' }, allowedFor: 'all' },
  { id: 'fs.watch', name: 'Watch Files', description: { 'zh-CN': '监听文件/目录变化（推送变更给所属插件）', 'en-US': 'Watch directory/file changes (push to owning plugin)' }, allowedFor: 'all' },
  { id: 'os.openExternal', name: 'Open External', description: { 'zh-CN': '用系统默认程序打开外部链接', 'en-US': 'Open external URLs' }, allowedFor: 'all' },
  { id: 'clipboard.read', name: 'Read Clipboard', description: { 'zh-CN': '读取剪贴板内容', 'en-US': 'Read clipboard content' }, allowedFor: 'all' },
  { id: 'clipboard.write', name: 'Write Clipboard', description: { 'zh-CN': '写入剪贴板', 'en-US': 'Write to clipboard' }, allowedFor: 'all' },
  { id: 'system.getIdleState', name: 'Idle State', description: { 'zh-CN': '获取系统空闲状态', 'en-US': 'Get system idle state' }, allowedFor: 'all' },
  { id: 'app.data', name: 'Plugin Data', description: { 'zh-CN': '插件隔离存储（USER_DATA/plugin-data/插件ID/ 下 JSON）', 'en-US': 'Isolated JSON storage under USER_DATA/plugin-data/<pluginId>/' }, allowedFor: 'all' },
  { id: 'app.setAutoLaunch', name: 'Auto Launch', description: { 'zh-CN': '设置开机自动启动', 'en-US': 'Set app auto-launch on login' }, allowedFor: 'all' },
  { id: 'app.shortcut.register', name: 'Register Shortcut', description: { 'zh-CN': '注册 / 注销全局快捷键', 'en-US': 'Register/unregister global shortcuts' }, allowedFor: 'all' },
  { id: 'app.crypt', name: 'Plugin Crypt', description: { 'zh-CN': '插件加解密（主进程按插件派生密钥）', 'en-US': 'Encrypt/decrypt with per-plugin key (derived in main process)' }, allowedFor: 'all' },
  { id: 'app.window', name: 'Window Control', description: { 'zh-CN': '控制主窗口（关闭等）', 'en-US': 'Control the main window (close, etc.)' }, allowedFor: 'all' },
  { id: 'app.menu', name: 'Native Menu', description: { 'zh-CN': '弹出原生右键菜单并返回选中项 id', 'en-US': 'Pop up native context menu and return the picked item id' }, allowedFor: 'all' },
  { id: 'plugins.dev', name: 'Dev Plugins', description: { 'zh-CN': '开发插件管理（按目录注册/移除 dev 插件与热重载）', 'en-US': 'Register/remove dev plugins by directory & hot reload' }, allowedFor: 'all' },
  { id: 'plugins.install', name: 'Plugin Market', description: { 'zh-CN': '插件市场（列出已安装 / 安装 / 卸载，主进程落地）', 'en-US': 'List installed plugins / install / uninstall (landing in main process)' }, allowedFor: 'all' },
  { id: 'child.spawn', name: 'Spawn Process', description: { 'zh-CN': '宿主代启动子进程（spawn / execFile，命令白名单校验）', 'en-US': 'Host-mediated subprocess spawn (spawn/execFile, command whitelist)' }, allowedFor: 'all' },
  { id: 'app.event', name: 'App Event', description: { 'zh-CN': '应用事件（经主进程转发主题/语言等到渲染层）', 'en-US': 'Forward event to renderer (theme / language) via main process' }, allowedFor: 'all' },
  { id: 'nativeTheme.system', name: 'System Theme', description: { 'zh-CN': '跟随系统主题变化（nativeTheme → 渲染层主题通道）', 'en-US': 'Follow OS theme changes (nativeTheme updated → renderer theme channel)' }, allowedFor: 'all' },
]

/** 获取内置能力清单副本（host-api / 权限展示等场景使用；与运行实例 defaults 一致） */
export function getDefaultCapabilities(): HostCapability[] {
  return DEFAULT_CAPABILITIES.map((c) => ({ ...c, description: { ...c.description } }))
}

export class HostCapabilities {
  private capabilities = new Map<string, HostCapability>()
  private pluginPermissions = new Map<string, Set<PluginPermission>>()

  constructor() {
    this.registerDefaultCapabilities()
  }

  private registerDefaultCapabilities(): void {
    DEFAULT_CAPABILITIES.forEach((c) => this.capabilities.set(c.id, c))
  }

  /** 追加注册能力（api 目录单一数据源注入；迁移完成后替代 DEFAULT_CAPABILITIES） */
  registerCapabilities(caps: HostCapability[]): void {
    caps.forEach((c) => this.capabilities.set(c.id, c))
  }

  grantPermissions(pluginId: string, permissions: PluginPermission[]): void {
    const set = this.pluginPermissions.get(pluginId) || new Set<PluginPermission>()
    permissions.forEach((p) => set.add(p))
    this.pluginPermissions.set(pluginId, set)
  }

  canAccess(
    pluginId: string,
    capabilityId: string,
    source: 'market' | 'local' | 'dev' = 'market',
  ): boolean {
    const capability = this.capabilities.get(capabilityId)
    if (!capability) return false
    const permissions = this.pluginPermissions.get(pluginId)
    if (!permissions) return false
    if (!permissions.has(capabilityId as PluginPermission)) return false
    if (capability.allowedFor === 'market' && source !== 'market') return false
    if (capability.allowedFor === 'local' && source !== 'local') return false
    return true
  }

  getCapabilities(): HostCapability[] {
    return Array.from(this.capabilities.values())
  }

  getPermissions(pluginId: string): PluginPermission[] {
    const set = this.pluginPermissions.get(pluginId)
    return set ? Array.from(set) : []
  }

  revokeAll(pluginId: string): void {
    this.pluginPermissions.delete(pluginId)
  }

  registerCapability(capability: HostCapability): void {
    this.capabilities.set(capability.id, capability)
  }
}
