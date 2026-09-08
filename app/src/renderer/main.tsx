/**
 * 渲染层入口：只做挂载，不对外导出任何东西。
 * 入口文件天然无导出，fast refresh 不适用。
 */
/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// 设计 Token：宿主全局引入一次（颜色/几何/排版/阴影/层级），插件共享本渲染进程，无需各自引入。
// 此处是 --dlient-* 变量的唯一定义源。
import './tokens.css'
import { I18nProvider, store as i18nStore } from '@dlient-open/i18n'   // 语言状态单例（插件/宿主共享，仅宿主挂载一次）
import { ensureUiStyles, Toaster } from '@dlient-open/ui'

// 先注入 @dlient-open/ui 自包含 shadcn 样式（:root/.dark 变量 + 工具类），
// 使 body 的 var(--background)/var(--foreground) 首帧即有值。
ensureUiStyles()

// 主题/语言由 setting 插件经主进程广播（render:theme / render:language，REPLAY 回放初始值）：
//   - 主题：主进程已把 system 解析为 dark/light，渲染层只做 class 切换
//     （tokens.css 内 :root.dark 暗色变量组，class 切换即可联动全部组件与插件样式）
//   - 语言：写入 i18n store（全渲染层共享，含全部插件 UI）
window.dlient.on('theme', (theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
})
window.dlient.on('language', (locale) => {
  i18nStore.setLocale(locale)
})

console.log('[renderer] module loaded; rendering')

// R1：共享渲染进程内禁用 HTML5 Notification（插件 UI 只能经 api.notification.* 走主进程出口）。
// configurable:false 后插件 delete/重新赋值均无效；new Notification(...) 与调用占位函数都会抛引导错误。
{
  const notificationGuard = new Proxy(function notificationGuard() {}, {
    construct() {
      throw new Error('HTML5 Notification 已在渲染端禁用，请使用 api.notification.send(...) 经主进程发送')
    },
    apply() {
      throw new Error('HTML5 Notification 已在渲染端禁用，请使用 api.notification.send(...) 经主进程发送')
    },
  })
  Object.defineProperty(window, 'Notification', { configurable: false, writable: false, value: notificationGuard })
}

// 前端错误捕获：宿主壳在共享渲染进程内监听未处理的 error / unhandledrejection。
// window 级事件不含插件归属 → 仅上报原文，主进程从错误栈的 dlientV3://plugin/<id>/ 帧解析归属
// （白名单校验）后写入该插件日志；解析失败自动回退主进程 [renderer:error]（现有 console-message 通道）。
function reportCaptured(kind: 'error' | 'unhandledrejection', err: unknown): void {
  try {
    const detail = err instanceof Error ? err : (err as { message?: string; stack?: string } | undefined)
    const message = detail?.message ? String(detail.message) : String(err ?? '')
    const stack = typeof detail?.stack === 'string' ? detail.stack : undefined
    if (!message && !stack) return
    window.dlient?.reportCapturedError?.({ kind, message, stack: stack ?? undefined })
  } catch {
    /* 上报链路异常忽略（不干扰渲染） */
  }
}
window.addEventListener('error', (event) => reportCaptured('error', event?.error ?? event?.message))
window.addEventListener('unhandledrejection', (event) => reportCaptured('unhandledrejection', event?.reason))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      {/* 全局单例 sonner Toaster（ui 包 Toaster 带单例守卫；message 兜底渲染同一组件会被去重） */}
      <Toaster position="top-center" />
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
console.log('[renderer] React mounted')
