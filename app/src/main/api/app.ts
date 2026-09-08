/**
 * api/app.ts - app 模块 host-api（元数据 + handler；复杂实现经 lib/app.ts / lib/child.ts）。
 */
import { app, globalShortcut } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DlientError, DlientErrorCode, logger } from '@dlient-open/core'
import type { ApiDefinition } from './types'
import { broadcastNotify } from '../notify'
import { getWindowController, pluginDataFilePath, popupNativeMenu } from '../lib/app'
import { createNativeHostProcess, hostKillChild, hostSpawnChild, toSpawnRef, type SpawnOptions } from '../lib/child'
import { decryptForPlugin, encryptForPlugin } from '../crypt'
import { atomicWriteFile, withFileLock } from '../file-queue'
import { broadcastAppSetting } from '../lib/theme'
import { mt } from '../i18n'

export const appApis: ApiDefinition[] = [
  {
    key: 'app.getVersion',
    description: { 'zh-CN': '宿主版本', 'en-US': 'Host version' },
    scope: 'all',
    level: 'default',
    handler: () => app.getVersion(),
  },
  {
    key: 'app.getPath',
    description: { 'zh-CN': '查询白名单路径（userData 返回插件隔离目录）', 'en-US': 'Query whitelisted path (userData returns plugin-isolated dir)' },
    scope: 'all',
    level: 'default',
    handler: ([name], ctx) => {
      const key = String(name)
      const allowed = ['userData', 'home', 'temp', 'documents', 'downloads', 'music', 'pictures', 'videos', 'recent', 'plugins']
      if (!allowed.includes(key)) throw new DlientError(DlientErrorCode.INVALID, `app.getPath not allowed: ${key}`)
      if (key === 'userData') return join(app.getPath('userData'), 'plugin-data', ctx.pluginId)
      if (key === 'plugins') return join(app.getPath('userData'), 'plugins')
      return app.getPath(key as Parameters<typeof app.getPath>[0])
    },
  },
  {
    key: 'app.isActive',
    description: { 'zh-CN': '宿主是否有聚焦窗口', 'en-US': 'Host has a focused window' },
    scope: 'all',
    level: 'default',
    handler: () => app.isActive(),
  },
  {
    key: 'app.isHidden',
    description: { 'zh-CN': '宿主是否所有窗口不可见', 'en-US': 'All host windows are hidden' },
    scope: 'all',
    level: 'default',
    handler: () => app.isHidden(),
  },
  {
    key: 'app.getName',
    description: { 'zh-CN': '宿主应用名', 'en-US': 'Host app name' },
    scope: 'all',
    level: 'default',
    handler: () => app.getName(),
  },
  {
    key: 'app.getLocale',
    description: { 'zh-CN': '宿主 locale', 'en-US': 'Host locale' },
    scope: 'all',
    level: 'default',
    handler: () => app.getLocale(),
  },
  {
    key: 'app.getLocaleCountryCode',
    description: { 'zh-CN': '宿主 locale 国家码', 'en-US': 'Host locale country code' },
    scope: 'all',
    level: 'default',
    handler: () => app.getLocaleCountryCode(),
  },
  {
    key: 'app.getSystemLocale',
    description: { 'zh-CN': '宿主系统 locale', 'en-US': 'Host system locale' },
    scope: 'all',
    level: 'default',
    handler: () => app.getSystemLocale(),
  },
  {
    key: 'app.getPreferredSystemLanguages',
    description: { 'zh-CN': '宿主首选系统语言列表', 'en-US': 'Host preferred system languages' },
    scope: 'all',
    level: 'default',
    handler: () => app.getPreferredSystemLanguages(),
  },
  {
    key: 'app.notify',
    description: { 'zh-CN': '发通知（receiver 含 __render 被剥离并告警）', 'en-US': 'Send notification (receiver __render stripped & warned)' },
    scope: 'worker',
    level: 'default',
    handler: ([payload], ctx) => {
      const p = (payload ?? {}) as { event?: string; receiver?: unknown; data?: unknown; event_id?: string }
      const event = String(p.event ?? '')
      if (!event) throw new DlientError(DlientErrorCode.INVALID, 'app.notify: event required')
      const all = Array.isArray(p.receiver) ? p.receiver.map(String) : []
      if (all.includes('__render')) {
        logger.warn('security', 'app.notify __render stripped', { pluginId: ctx.pluginId, event, receiver: all })
      }
      const receiver = all.filter((r) => r !== '__render')
      broadcastNotify({ event, event_id: String(p.event_id ?? `${event}-${Date.now()}`), receiver, data: p.data, from: ctx.pluginId })
      return { ok: true }
    },
  },
]

/** 主窗口无参动作（无头模式自绘标题栏控制） */
const WINDOW_ACTIONS = ['close', 'focus', 'blur', 'show', 'hide', 'maximize', 'unmaximize', 'minimize', 'restore'] as const

/** 窗口控制方法集（worker 自绘标题栏经宿主 app.window.* 转发；UI 直连不开放） */
const windowApis: ApiDefinition[] = [
  ...WINDOW_ACTIONS.map((m): ApiDefinition => ({
    key: `app.window.${m}`,
    description: { 'zh-CN': `主窗口 ${m}`, 'en-US': `Main window ${m}` },
    scope: 'worker',
    level: m === 'close' ? 'warn' : 'default',
    handler: () => getWindowController()?.[m](),
  })),
  {
    key: 'app.window.isMaximized',
    description: { 'zh-CN': '主窗口是否最大化', 'en-US': 'Main window maximized' },
    scope: 'worker',
    level: 'default',
    handler: () => getWindowController()?.isMaximized() ?? false,
  },
  {
    key: 'app.window.setFullScreen',
    description: { 'zh-CN': '设置主窗口全屏', 'en-US': 'Set main window full screen' },
    scope: 'worker',
    level: 'default',
    handler: ([flag]) => getWindowController()?.setFullScreen(!!flag),
  },
]

/** app 模块扩展方法（data/crypt/setAutoLaunch/shortcut/event/window/menu/createNativeHost；实现经 lib/app + lib/child） */
export const appExtraApis: ApiDefinition[] = [
  ...windowApis,
  {
    key: 'app.data.read',
    description: { 'zh-CN': '读取插件自有数据', 'en-US': 'Read plugin data' },
    scope: 'all',
    level: 'default',
    handler: async ([file], ctx) => {
      const filePath = pluginDataFilePath(ctx.pluginId, file)
      return withFileLock(filePath, async () => {
        try {
          const content = await readFile(filePath, 'utf-8')
          return JSON.parse(content)
        } catch {
          return null
        }
      })
    },
  },
  {
    key: 'app.data.write',
    description: { 'zh-CN': '写入插件自有数据', 'en-US': 'Write plugin data' },
    scope: 'all',
    level: 'default',
    handler: async ([file, json], ctx) => {
      const filePath = pluginDataFilePath(ctx.pluginId, file)
      await withFileLock(filePath, () => atomicWriteFile(filePath, JSON.stringify(json, null, 2), 'utf-8'))
    },
  },
  {
    key: 'app.crypt.encrypt',
    description: { 'zh-CN': '插件级加密', 'en-US': 'Plugin-scoped encrypt' },
    scope: 'all',
    level: 'default',
    handler: ([plain], ctx) => encryptForPlugin(ctx.pluginId, String(plain)),
  },
  {
    key: 'app.crypt.decrypt',
    description: { 'zh-CN': '插件级解密', 'en-US': 'Plugin-scoped decrypt' },
    scope: 'all',
    level: 'default',
    handler: ([b64], ctx) => decryptForPlugin(ctx.pluginId, String(b64)),
  },
  {
    key: 'app.setAutoLaunch',
    description: { 'zh-CN': '设置开机自启', 'en-US': 'Toggle auto launch' },
    scope: 'worker',
    level: 'dangerous',
    handler: async ([enabled]) => {
      app.setLoginItemSettings({ openAtLogin: !!enabled })
    },
  },
  {
    key: 'app.shortcut.register',
    description: { 'zh-CN': '注册全局快捷键', 'en-US': 'Register global shortcut' },
    scope: 'worker',
    level: 'dangerous',
    handler: ([opts], ctx) => {
      const { id, accelerator } = (typeof opts === 'object' && opts !== null ? opts : {}) as {
        id?: string
        accelerator?: string
        action?: string
      }
      const shortcutId = String(id ?? '')
      const acc = String(accelerator ?? '')
      if (!shortcutId || !acc) throw new DlientError(DlientErrorCode.INVALID, 'app.shortcut.register requires { id, accelerator, action }')
      globalShortcut.unregister(acc)
      let ok = false
      try {
        ok = globalShortcut.register(acc, () => ctx.runShortcutAction(shortcutId))
      } catch {
        throw new DlientError(DlientErrorCode.INVALID, `invalid accelerator: ${acc}`)
      }
      if (!ok) throw new DlientError(DlientErrorCode.INTERNAL, mt('shortcut.registerBusy', { acc }))
    },
  },
  {
    key: 'app.shortcut.unregister',
    description: { 'zh-CN': '注销全局快捷键', 'en-US': 'Unregister global shortcut' },
    scope: 'worker',
    level: 'dangerous',
    handler: ([accelerator]) => {
      globalShortcut.unregister(String(accelerator))
    },
  },
  {
    key: 'app.event',
    description: { 'zh-CN': '全局设置变更中转（theme/language）', 'en-US': 'Forward global setting (theme/language)' },
    scope: 'worker',
    level: 'default',
    handler: ([channel, value]) => {
      const ch = String(channel ?? '')
      if (ch !== 'theme' && ch !== 'language') {
        throw new DlientError(DlientErrorCode.INVALID, `app.event channel not allowed: ${ch}`)
      }
      broadcastAppSetting(ch, value)
    },
  },
  {
    key: 'app.menu.popup',
    description: { 'zh-CN': '弹出原生右键菜单', 'en-US': 'Pop up native context menu' },
    scope: 'worker',
    level: 'warn',
    handler: ([opts]) => popupNativeMenu(opts),
  },
  {
    key: 'app.createNativeHost',
    description: { 'zh-CN': '代管启动原生 Node 进程', 'en-US': 'Host native Node process' },
    scope: 'worker',
    level: 'dangerous',
    handler: async ([options], ctx) => toSpawnRef(await createNativeHostProcess(ctx.pluginId, (options ?? {}) as { fileName?: string; node?: string })),
  },
  {
    key: 'app.createNativeClient',
    description: { 'zh-CN': '创建原生进程客户端', 'en-US': 'Create native client' },
    scope: 'worker',
    level: 'dangerous',
    handler: async ([options], ctx) => toSpawnRef(await hostSpawnChild(ctx.pluginId, (options ?? {}) as SpawnOptions)),
  },
  {
    key: 'app.disposeNativeClient',
    description: { 'zh-CN': '销毁原生进程客户端', 'en-US': 'Dispose native client' },
    scope: 'worker',
    level: 'dangerous',
    handler: ([handleId]) => hostKillChild(String(handleId ?? '')),
  },
]
