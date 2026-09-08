/**
 * lib/theme.ts - 主题/语言全局状态与广播（方案 v2：从 export.ts 下沉）。
 * 服务对象：宿主弹框取当前主题（getCurrentTheme）、nativeTheme 系统主题跟随（api/system.ts
 * system.listenNativeTheme）、app.event 全局设置广播（api/app.ts，theme/language → 渲染层通道）。
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { RendererChannels } from '@dlient-open/core'
import { setMainLocale } from '../i18n'

function sendToAllWindows(channel: string, value: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, value)
  }
}

let systemThemeListening = false

/** 当前主题（主进程缓存：初始取系统，随 nativeTheme / setting 广播更新；供主进程弹框等取用） */
let currentTheme: 'dark' | 'light' = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'

export function getCurrentTheme(): 'dark' | 'light' {
  return currentTheme
}

/** nativeTheme 系统主题变化 → 转发渲染层 theme 通道（当前解析值 dark/light） */
function sendResolvedTheme(): void {
  currentTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  sendToAllWindows(RendererChannels.THEME, currentTheme)
}

/** 系统主题跟随开关：theme=system（true）→ 立即广播当前解析值并开启 nativeTheme 监听，
 * OS 主题变化自动转发渲染层；固定主题（false）→ 关闭监听（由 setting 插件 app.event 主动广播）。
 * （api/system.ts system.listenNativeTheme handler 使用） */
export function useSystemNativeTheme(useSystem: boolean): void {
  if (useSystem) {
    sendResolvedTheme()
    if (!systemThemeListening) {
      nativeTheme.on('updated', sendResolvedTheme)
      systemThemeListening = true
    }
  } else if (systemThemeListening) {
    nativeTheme.off('updated', sendResolvedTheme)
    systemThemeListening = false
  }
}

/** app.event 全局设置广播（theme / language）：主进程缓存同步 + 渲染层通道转发（api/app.ts handler 使用） */
export function broadcastAppSetting(channel: 'theme' | 'language', value: unknown): void {
  if (channel === 'theme') {
    currentTheme = value === 'dark' ? 'dark' : 'light'
    sendToAllWindows(RendererChannels.THEME, currentTheme)
  } else {
    // 主进程语言缓存同步（供主进程文案 mt() 与 worker i18n.getLocale 使用）
    setMainLocale(value)
    sendToAllWindows(RendererChannels.LANGUAGE, value === 'zh-CN' ? 'zh-CN' : 'en-US')
  }
}
