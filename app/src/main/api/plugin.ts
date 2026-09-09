/**
 * api/plugin.ts - plugin 模块 host-api（元数据 + handler；实现经 lib/plugin.ts）。
 * 命名已切换：plugins.* → plugin.*（v2 §6.2）；host.capabilities.list → plugin.capabilities；
 * 新增 plugin.setActive（原 webview.setActivePlugin 归属此处）。
 */
import type { ApiDefinition } from './types'
import {
  cleanupUninstallPlugin,
  devClearLogs,
  devGetDirInfo,
  devIsPortReady,
  devReadLogs,
  devSelectDirectory,
  devStartWatcher,
  devStartWorker,
  devStopWatcher,
  devStopWorker,
  devSyncFromRuntime,
  installLocalPlugin,
  installPluginViaHost,
  isPluginRunning,
  listPluginCapabilities,
  listSystemPlugins,
  pluginRuntimeStates,
  reportPluginRegistry,
  scanInstalledPlugins,
  startPlugin,
  stopPlugin,
  subscribePluginLogs,
  unsubscribePluginLogs,
} from '../lib/plugin'
import { webviewSetActivePlugin } from '../lib/webview'

const mgmt = (key: string, zh: string, en: string) => ({ key, description: { 'zh-CN': zh, 'en-US': en }, scope: 'system' as const, level: 'dangerous' as const })
const dev = (key: string, zh: string, en: string) => ({ key, description: { 'zh-CN': zh, 'en-US': en }, scope: 'worker' as const, level: 'dangerous' as const })

export const pluginApis: ApiDefinition[] = [
  { key: 'plugin.capabilities', description: { 'zh-CN': '宿主能力清单（api 目录全量元数据）', 'en-US': 'Host capability list (full api metadata)' }, scope: 'system', level: 'default', handler: () => listPluginCapabilities() },
  { ...mgmt('plugin.registry.report', '上报插件注册表', 'Report plugin registry'), handler: ([entries]) => reportPluginRegistry(entries) },
  { ...mgmt('plugin.start', '启动插件 worker', 'Start plugin worker'), handler: ([pluginId]) => startPlugin(String(pluginId ?? '')) },
  { ...mgmt('plugin.stop', '停止插件 worker', 'Stop plugin worker'), handler: ([pluginId]) => stopPlugin(String(pluginId ?? '')) },
  { ...mgmt('plugin.system', '系统级插件清单', 'System plugins list'), handler: () => listSystemPlugins() },
  // 下列为只读扫描/自装载原语：dev-tools（非 system）编排 dev/本地插件也需要，scope 用 worker（方法级声明 + canAccess 兜底）
  { ...dev('plugin.scanInstalled', '扫描已安装插件', 'Scan installed plugins'), handler: () => scanInstalledPlugins() },
  { ...dev('plugin.runtimeList', '插件运行态列表', 'Plugin runtime list'), handler: () => pluginRuntimeStates() },
  { ...dev('plugin.installLocal', '导入本地插件', 'Install local plugin'), handler: ([dir]) => installLocalPlugin(dir) },
  { ...dev('plugin.install', '安装插件（.dlient/npm/github/URL，含 preInstall 依赖）', 'Install plugin (.dlient/npm/github/URL, incl. preInstall deps)'), handler: ([req]) => installPluginViaHost(req as { kind?: 'file' | 'npm' | 'github' | 'url'; id?: string; source: string }) },
  { ...mgmt('plugin.isRunning', '插件运行态查询', 'Plugin running check'), handler: ([pluginId]) => isPluginRunning(String(pluginId ?? '')) },
  { ...mgmt('plugin.cleanupUninstall', '卸载后清理', 'Cleanup after uninstall'), handler: ([pluginId]) => cleanupUninstallPlugin(String(pluginId ?? '')) },
  { ...dev('plugin.dev.selectDirectory', '选择 dev 插件目录', 'Select dev plugin dir'), handler: () => devSelectDirectory() },
  { ...dev('plugin.dev.getDirInfo', '查询 dev 插件目录信息', 'Get dev plugin dir info'), handler: ([pluginId]) => devGetDirInfo(String(pluginId ?? '')) },
  { ...dev('plugin.dev.sync', '同步 dev 清单到宿主', 'Sync dev list to host'), handler: ([entries]) => devSyncFromRuntime(entries) },
  { ...dev('plugin.dev.startWatcher', '启动 dev 热重载监听', 'Start dev watcher'), handler: ([pluginId]) => devStartWatcher(String(pluginId ?? '')) },
  { ...dev('plugin.dev.stopWatcher', '停止 dev 热重载监听', 'Stop dev watcher'), handler: ([pluginId]) => devStopWatcher(String(pluginId ?? '')) },
  { ...dev('plugin.dev.startDevWorker', '启动 dev 实例 worker', 'Start dev worker'), handler: ([pluginId]) => devStartWorker(String(pluginId ?? '')) },
  { ...dev('plugin.dev.stopDevWorker', '停止 dev 实例 worker', 'Stop dev worker'), handler: ([pluginId]) => devStopWorker(String(pluginId ?? '')) },
  { ...dev('plugin.dev.isPortReady', 'dev 实例端口就绪查询', 'Dev instance port ready'), handler: ([pluginId]) => devIsPortReady(String(pluginId ?? '')) },
  { ...dev('plugin.dev.readLogs', '读取目标插件日志', 'Read target plugin logs'), handler: ([pluginId, options]) => devReadLogs(String(pluginId ?? ''), options) },
  { ...dev('plugin.dev.clearLogs', '清空目标插件日志', 'Clear target plugin logs'), handler: ([pluginId]) => devClearLogs(String(pluginId ?? '')) },
  { ...dev('plugin.logs.subscribe', '订阅插件日志', 'Subscribe plugin logs'), handler: ([pluginId], ctx) => subscribePluginLogs(String(pluginId ?? ''), String(ctx.pluginId ?? '')) },
  { ...dev('plugin.logs.unsubscribe', '取消订阅插件日志', 'Unsubscribe plugin logs'), handler: ([pluginId, subId]) => unsubscribePluginLogs(String(pluginId ?? ''), String(subId ?? '')) },
  { key: 'plugin.setActive', description: { 'zh-CN': '设置内容区活动插件（原 webview.setActivePlugin）', 'en-US': 'Set active plugin (was webview.setActivePlugin)' }, scope: 'worker', level: 'warn', handler: ([pluginId]) => webviewSetActivePlugin(pluginId) },
]
