/**
 * host-api.ts - rpc.xx.xx 宿主能力类型快照 + 运行时模块树构建。
 *
 * 目标：manifest.permissions 里的 key（如 'child.spawn'）与开发者调用词汇一一对应——
 *   rpc.child.spawn(...) / rpc.fs.read(...) / rpc.app.getPath(...) / rpc.plugin.invoke(...)，
 * 取消 rpc.callHostApi / rpc.api / 字符串方法名等其它调用方式。
 *
 * 本文件是"静态类型快照"（随 @dlient-open/plugin-sdk 发版，手写维护）：每个模块把宿主
 * api 表（app/src/main/api/*）暴露的方法名列全，缺失/新增方法请同步本文件；
 * 宿主 api 表的跨包校验在仓库脚本 scripts 中完成（app 与 sdk 同仓，发布前比对 listApiKeys）。
 *
 * 特殊方法 child.spawn / child.execFile 不是"直通"——SDK 在返回前会自动完成
 * child-subscribe 订阅与回放，返回可监听的 ChildHandle，签名见下。
 */

import type { ChildHandle, SpawnHostedOptions } from './worker'

/** 通用宿主方法调用签名（参数/返回保持透传，插件侧按需收窄） */
export type HostCall = (...args: any[]) => Promise<any>

/* ------------------------------------------------------------------ */
/* 模块级静态快照（方法名与宿主 api 表一一对应）                          */
/* ------------------------------------------------------------------ */

export interface AppWindowModule {
  close: HostApiMap['app.window.close']
  focus: HostApiMap['app.window.focus']
  blur: HostApiMap['app.window.blur']
  show: HostApiMap['app.window.show']
  hide: HostApiMap['app.window.hide']
  maximize: HostApiMap['app.window.maximize']
  unmaximize: HostApiMap['app.window.unmaximize']
  minimize: HostApiMap['app.window.minimize']
  restore: HostApiMap['app.window.restore']
  isMaximized: HostApiMap['app.window.isMaximized']
  setFullScreen: HostApiMap['app.window.setFullScreen']
}

export interface AppDataModule {
  read: HostApiMap['app.data.read']
  write: HostApiMap['app.data.write']
}

export interface AppCryptModule {
  encrypt: HostApiMap['app.crypt.encrypt']
  decrypt: HostApiMap['app.crypt.decrypt']
}

export interface AppShortcutModule {
  register: HostApiMap['app.shortcut.register']
  unregister: HostApiMap['app.shortcut.unregister']
}

export interface AppMenuModule {
  popup: HostApiMap['app.menu.popup']
}

export interface AppModule {
  getVersion: HostApiMap['app.getVersion']
  getPath: HostApiMap['app.getPath']
  isActive: HostApiMap['app.isActive']
  isHidden: HostApiMap['app.isHidden']
  getName: HostApiMap['app.getName']
  getLocale: HostApiMap['app.getLocale']
  getLocaleCountryCode: HostApiMap['app.getLocaleCountryCode']
  getSystemLocale: HostApiMap['app.getSystemLocale']
  getPreferredSystemLanguages: HostApiMap['app.getPreferredSystemLanguages']
  notify: HostApiMap['app.notify']
  setAutoLaunch: HostApiMap['app.setAutoLaunch']
  event: HostApiMap['app.event']
  createNativeHost: HostApiMap['app.createNativeHost']
  createNativeClient: HostApiMap['app.createNativeClient']
  disposeNativeClient: HostApiMap['app.disposeNativeClient']
  window: AppWindowModule
  data: AppDataModule
  crypt: AppCryptModule
  shortcut: AppShortcutModule
  menu: AppMenuModule
}

export interface ChildModule {
  /** 宿主代 spawn（child.spawn）：返回可监听 ChildHandle；SDK 自动完成订阅/回放 */
  spawn(options: SpawnHostedOptions): Promise<ChildHandle>
  /** 宿主代 execFile（child.execFile）：一次性捕获 { stdout, stderr, code } */
  execFile(options: SpawnHostedOptions & { timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }>
}

export interface ClipboardModule {
  readText: HostApiMap['clipboard.readText']
  readHTML: HostApiMap['clipboard.readHTML']
  readRTF: HostApiMap['clipboard.readRTF']
  readBookmark: HostApiMap['clipboard.readBookmark']
  readFindText: HostApiMap['clipboard.readFindText']
  readImage: HostApiMap['clipboard.readImage']
  readBuffer: HostApiMap['clipboard.readBuffer']
  read: HostApiMap['clipboard.read']
  availableFormats: HostApiMap['clipboard.availableFormats']
  has: HostApiMap['clipboard.has']
  writeText: HostApiMap['clipboard.writeText']
  writeHTML: HostApiMap['clipboard.writeHTML']
  writeRTF: HostApiMap['clipboard.writeRTF']
  writeBookmark: HostApiMap['clipboard.writeBookmark']
  writeFindText: HostApiMap['clipboard.writeFindText']
  writeImage: HostApiMap['clipboard.writeImage']
  writeBuffer: HostApiMap['clipboard.writeBuffer']
  write: HostApiMap['clipboard.write']
  clear: HostApiMap['clipboard.clear']
}

export interface DialogModule {
  showMessageBox: HostApiMap['dialog.showMessageBox']
  showOpenDialog: HostApiMap['dialog.showOpenDialog']
  showSaveDialog: HostApiMap['dialog.showSaveDialog']
}

export interface FsModule {
  read: HostApiMap['fs.read']
  stat: HostApiMap['fs.stat']
  listDir: HostApiMap['fs.listDir']
  watch: HostApiMap['fs.watch']
  unwatch: HostApiMap['fs.unwatch']
  mkdir: HostApiMap['fs.mkdir']
  write: HostApiMap['fs.write']
  append: HostApiMap['fs.append']
  delete: HostApiMap['fs.delete']
  copyDir: HostApiMap['fs.copyDir']
  lock: HostApiMap['fs.lock']
  unlock: HostApiMap['fs.unlock']
  withLock: HostApiMap['fs.withLock']
}

export interface I18nModule {
  getLocale: HostApiMap['i18n.getLocale']
}

export interface LogModule {
  /** 写入插件日志（声明 manifest.permissions 的 log 即可，无需 fs 权限；宿主按调用方身份落插件日志） */
  write(level?: 'debug' | 'info' | 'warn' | 'error', message?: string, data?: unknown): Promise<{ ok: boolean }>
}

export interface NetModule {
  isOnline: HostApiMap['net.isOnline']
  fetch: HostApiMap['net.fetch']
  request: HostApiMap['net.request']
  getFreePort: HostApiMap['net.getFreePort']
  probePort: HostApiMap['net.probePort']
}

/** 内置 Node.js 运行时（开源版并入宿主主进程，替代闭源 nodejs 插件的跨插件 invoke） */
export interface NodejsModule {
  checkLocal: HostApiMap['nodejs.checkLocal']
  checkBundled: HostApiMap['nodejs.checkBundled']
  resolveRuntime: HostApiMap['nodejs.resolveRuntime']
  install: HostApiMap['nodejs.install']
}

// 单源类型（@dlient-open/api-types）：通知 options/事件 payload 与主进程/UI 端共享同一定义。
import type { HostApiMap, NotificationSendOptions, NotificationHandle } from '@dlient-open/api-types'
export type { NotificationSendOptions, NotificationEventPayload, NotificationHandle } from '@dlient-open/api-types'

export interface NotificationModule {
  isSupported: HostApiMap['notification.isSupported']
  /** send 返回句柄：内部自动订阅宿主事件（notification-event 经控制面回推），支持 on(...) 监听 */
  send: (options: NotificationSendOptions) => Promise<NotificationHandle>
  remove: HostApiMap['notification.remove']
  removeGroup: HostApiMap['notification.removeGroup']
  subscribe: HostApiMap['notification.subscribe']
  unsubscribe: HostApiMap['notification.unsubscribe']
}

export interface OsModule {
  openExternal: HostApiMap['os.openExternal']
  showItemInFolder: HostApiMap['os.showItemInFolder']
}

export interface PermissionModule {
  'plugin.list': HostApiMap['permission.plugin.list']
  revoke: HostApiMap['permission.revoke']
  request: HostApiMap['permission.request']
  list: HostApiMap['permission.list']
}

export interface PluginDevModule {
  selectDirectory: HostApiMap['plugin.dev.selectDirectory']
  getDirInfo: HostApiMap['plugin.dev.getDirInfo']
  sync: HostApiMap['plugin.dev.sync']
  startWatcher: HostApiMap['plugin.dev.startWatcher']
  stopWatcher: HostApiMap['plugin.dev.stopWatcher']
  startDevWorker: HostApiMap['plugin.dev.startDevWorker']
  stopDevWorker: HostApiMap['plugin.dev.stopDevWorker']
  isPortReady: HostApiMap['plugin.dev.isPortReady']
  readLogs: HostApiMap['plugin.dev.readLogs']
  clearLogs: HostApiMap['plugin.dev.clearLogs']
  /** 兼容旧宿主（旧版 dev 清单/移除；不存在时运行时拒绝，与旧行为一致） */
  list: HostApiMap['plugin.dev.list']
  remove: HostApiMap['plugin.dev.remove']
}

export interface PluginLogsModule {
  subscribe: HostApiMap['plugin.logs.subscribe']
  unsubscribe: HostApiMap['plugin.logs.unsubscribe']
}

export interface PluginRegistryModule {
  report: HostApiMap['plugin.registry.report']
}

export interface PluginModule {
  /** 跨插件调用（plugin.invoke）：expose + dependencies 由主进程校验 */
  invoke: (targetPluginId: string, method: string, args?: unknown[]) => Promise<unknown>
  /** 主动预授权（plugin.requestGrant）：主进程补全调用方身份后调被调用方 grant（allow/ask/deny 三态） */
  requestGrant: (
    targetPluginId: string,
    method: string,
    data?: unknown,
  ) => Promise<{ allowed: boolean; scope?: 'persistent' | 'session'; reason?: string }>
  capabilities: HostApiMap['plugin.capabilities']
  start: HostApiMap['plugin.start']
  stop: HostApiMap['plugin.stop']
  system: HostApiMap['plugin.system']
  scanInstalled: HostApiMap['plugin.scanInstalled']
  runtimeList: HostApiMap['plugin.runtimeList']
  installLocal: HostApiMap['plugin.installLocal']
  isRunning: HostApiMap['plugin.isRunning']
  cleanupUninstall: HostApiMap['plugin.cleanupUninstall']
  setActive: HostApiMap['plugin.setActive']
  registry: PluginRegistryModule
  dev: PluginDevModule
  logs: PluginLogsModule
}

export interface PowerSaveBlockerModule {
  start: HostApiMap['powerSaveBlocker.start']
  stop: HostApiMap['powerSaveBlocker.stop']
  isStarted: HostApiMap['powerSaveBlocker.isStarted']
}

export interface ScreenModule {
  getCursorScreenPoint: HostApiMap['screen.getCursorScreenPoint']
  getPrimaryDisplay: HostApiMap['screen.getPrimaryDisplay']
  getAllDisplays: HostApiMap['screen.getAllDisplays']
  getDisplayNearestPoint: HostApiMap['screen.getDisplayNearestPoint']
  getDisplayMatching: HostApiMap['screen.getDisplayMatching']
  screenToDipPoint: HostApiMap['screen.screenToDipPoint']
  dipToScreenPoint: HostApiMap['screen.dipToScreenPoint']
  screenToDipRect: HostApiMap['screen.screenToDipRect']
  dipToScreenRect: HostApiMap['screen.dipToScreenRect']
}

export interface SystemModule {
  getIdleState: HostApiMap['system.getIdleState']
  listenNativeTheme: HostApiMap['system.listenNativeTheme']
}

export interface WebviewModule {
  create: HostApiMap['webview.create']
  update: HostApiMap['webview.update']
  destroy: HostApiMap['webview.destroy']
  setVisible: HostApiMap['webview.setVisible']
  webContentsCall: HostApiMap['webview.webContentsCall']
  showWebviewByPlugin: HostApiMap['webview.showWebviewByPlugin']
  hideWebviewByPlugin: HostApiMap['webview.hideWebviewByPlugin']
}

/** 全部宿主能力模块（rpc 顶层命名空间；child 为 SDK 特型，其余为直通/透传） */
export interface HostApiSurface {
  app: AppModule
  child: ChildModule
  clipboard: ClipboardModule
  dialog: DialogModule
  fs: FsModule
  i18n: I18nModule
  net: NetModule
  nodejs: NodejsModule
  notification: NotificationModule
  log: LogModule
  os: OsModule
  permission: PermissionModule
  plugin: PluginModule
  powerSaveBlocker: PowerSaveBlockerModule
  screen: ScreenModule
  system: SystemModule
  webview: WebviewModule
}

/* ------------------------------------------------------------------ */
/* 运行时模块树（"module.method" 或 "a.b.method" 点路径 → 嵌套函数对象）  */
/* ------------------------------------------------------------------ */

/**
 * 宿主 api 点路径清单（与 HostApiSurface 同源；child.* 不在此列——
 * child.spawn / child.execFile 由 createWorkerRpc 以 SDK 特型实现）。
 */
export const HOST_API_PATHS: string[] = [
  // app
  'app.getVersion',
  'app.getPath',
  'app.isActive',
  'app.isHidden',
  'app.getName',
  'app.getLocale',
  'app.getLocaleCountryCode',
  'app.getSystemLocale',
  'app.getPreferredSystemLanguages',
  'app.notify',
  'app.setAutoLaunch',
  'app.event',
  'app.createNativeHost',
  'app.createNativeClient',
  'app.disposeNativeClient',
  'app.window.close',
  'app.window.focus',
  'app.window.blur',
  'app.window.show',
  'app.window.hide',
  'app.window.maximize',
  'app.window.unmaximize',
  'app.window.minimize',
  'app.window.restore',
  'app.window.isMaximized',
  'app.window.setFullScreen',
  'app.data.read',
  'app.data.write',
  'app.crypt.encrypt',
  'app.crypt.decrypt',
  'app.shortcut.register',
  'app.shortcut.unregister',
  'app.menu.popup',
  // clipboard
  ...['read', 'write', 'clear', 'has', 'availableFormats'].map((m) => `clipboard.${m}`),
  ...['Text', 'HTML', 'RTF', 'Bookmark', 'FindText', 'Image', 'Buffer'].flatMap((s) => [
    `clipboard.read${s}`,
    `clipboard.write${s}`,
  ]),
  // dialog
  'dialog.showMessageBox',
  'dialog.showOpenDialog',
  'dialog.showSaveDialog',
  // fs
  'fs.read',
  'fs.stat',
  'fs.listDir',
  'fs.watch',
  'fs.unwatch',
  'fs.mkdir',
  'fs.write',
  'fs.append',
  'fs.delete',
  'fs.copyDir',
  'fs.lock',
  'fs.unlock',
  'fs.withLock',
  // i18n / net / notification / os
  'i18n.getLocale',
  'net.isOnline',
  'net.fetch',
  'net.request',
  'net.getFreePort',
  'net.probePort',
  // nodejs（内置运行时：直接宿主调用，替代旧跨插件 invoke）
  'nodejs.checkLocal',
  'nodejs.checkBundled',
  'nodejs.resolveRuntime',
  'nodejs.install',
  'notification.isSupported',
  'notification.send',
  'notification.remove',
  'notification.removeGroup',
  'notification.subscribe',
  'notification.unsubscribe',
  // log
  'log.write',
  // os
  'os.openExternal',
  'os.showItemInFolder',
  // permission
  'permission.plugin.list',
  'permission.revoke',
  'permission.request',
  'permission.list',
  // plugin
  'plugin.invoke',
  'plugin.requestGrant',
  'plugin.capabilities',
  'plugin.registry.report',
  'plugin.start',
  'plugin.stop',
  'plugin.system',
  'plugin.scanInstalled',
  'plugin.runtimeList',
  'plugin.installLocal',
  'plugin.isRunning',
  'plugin.cleanupUninstall',
  'plugin.setActive',
  'plugin.dev.selectDirectory',
  'plugin.dev.getDirInfo',
  'plugin.dev.sync',
  'plugin.dev.startWatcher',
  'plugin.dev.stopWatcher',
  'plugin.dev.startDevWorker',
  'plugin.dev.stopDevWorker',
  'plugin.dev.isPortReady',
  'plugin.dev.readLogs',
  'plugin.dev.clearLogs',
  'plugin.dev.list',
  'plugin.dev.remove',
  'plugin.logs.subscribe',
  'plugin.logs.unsubscribe',
  // powerSaveBlocker / screen / system / webview
  'powerSaveBlocker.start',
  'powerSaveBlocker.stop',
  'powerSaveBlocker.isStarted',
  'screen.getCursorScreenPoint',
  'screen.getPrimaryDisplay',
  'screen.getAllDisplays',
  'screen.getDisplayNearestPoint',
  'screen.getDisplayMatching',
  'screen.screenToDipPoint',
  'screen.dipToScreenPoint',
  'screen.screenToDipRect',
  'screen.dipToScreenRect',
  'system.getIdleState',
  'system.listenNativeTheme',
  'webview.create',
  'webview.update',
  'webview.destroy',
  'webview.setVisible',
  'webview.webContentsCall',
  'webview.showWebviewByPlugin',
  'webview.hideWebviewByPlugin',
]

/** 按点路径把叶子挂到嵌套对象上（module / a.b / a.b.c 均支持） */
function assignPath(root: Record<string, unknown>, path: string, call: (method: string, args: unknown[]) => Promise<unknown>): void {
  const parts = path.split('.')
  const method = parts.pop() as string
  let node = root
  for (const p of parts) {
    if (typeof node[p] !== 'object' || node[p] === null) node[p] = {}
    node = node[p] as Record<string, unknown>
  }
  node[method] = (...args: unknown[]) => call(path, args)
}

/** 构建 rpc.xx.xx 模块树（叶子函数执行宿主调用；child 由 SDK 特型实现，不入树） */
export function createHostApiModules(call: (method: string, args: unknown[]) => Promise<unknown>): Omit<HostApiSurface, 'child'> {
  const root: Record<string, unknown> = {}
  for (const path of HOST_API_PATHS) assignPath(root, path, call)
  return root as unknown as Omit<HostApiSurface, 'child'>
}
