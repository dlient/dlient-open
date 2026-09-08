/**
 * api/webview.ts - webview 模块 host-api（元数据 + handler；实现经 lib/webview.ts 转发 WebviewManager）。
 * v2 §6.5 精简完成：setActivePlugin → plugin.setActive（plugin 模块）；destroyByOwner/getActivePlugin 已移除（宿主内部逻辑保留）。
 */
import type { ApiDefinition } from './types'
import {
  webviewCreate,
  webviewDestroy,
  webviewHideByPlugin,
  webviewSetVisible,
  webviewShowByPlugin,
  webviewUpdate,
  webviewWebContentsCall,
} from '../lib/webview'

export const webviewApis: ApiDefinition[] = [
  { key: 'webview.create', description: { 'zh-CN': '创建内嵌 webview', 'en-US': 'Create embedded webview' }, scope: 'worker', level: 'warn', handler: ([opts]) => webviewCreate(opts) },
  { key: 'webview.update', description: { 'zh-CN': '更新 webview bounds', 'en-US': 'Update webview bounds' }, scope: 'worker', level: 'warn', handler: ([opts]) => webviewUpdate(opts) },
  { key: 'webview.destroy', description: { 'zh-CN': '销毁 webview', 'en-US': 'Destroy webview' }, scope: 'worker', level: 'warn', handler: ([viewId]) => webviewDestroy(viewId) },
  { key: 'webview.setVisible', description: { 'zh-CN': '设置 webview 可见性', 'en-US': 'Set webview visibility' }, scope: 'worker', level: 'warn', handler: ([opts]) => webviewSetVisible(opts) },
  { key: 'webview.webContentsCall', description: { 'zh-CN': '对 webview 执行 JS/调 webContents', 'en-US': 'Call into webview webContents' }, scope: 'worker', level: 'dangerous', handler: ([opts]) => webviewWebContentsCall(opts) },
  { key: 'webview.showWebviewByPlugin', description: { 'zh-CN': '按插件显示其 webview', 'en-US': 'Show webviews by plugin' }, scope: 'worker', level: 'warn', handler: ([views], ctx) => webviewShowByPlugin(views, ctx.pluginId) },
  { key: 'webview.hideWebviewByPlugin', description: { 'zh-CN': '按插件隐藏其 webview', 'en-US': 'Hide webviews by plugin' }, scope: 'worker', level: 'warn', handler: (_args, ctx) => webviewHideByPlugin(ctx.pluginId) },
]
