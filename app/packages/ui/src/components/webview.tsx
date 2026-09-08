/**
 * Webview - 宿主 UI 库的内嵌网页组件（@dlient-open/ui）。
 *
 * 职责：渲染占位容器 + 测量 bounds，把位置/尺寸、生命周期事件、webContents 白名单方法调用
 * 经「承载插件」的 worker 转发到主进程 WebContentsView（webview-manager）。
 * 转发能力内建在 @dlient-open/plugin-sdk 的 createWorkerRpc（webview:* handler + onWebContentsEvent 推送），
 * 使用方插件只需在 manifest.permissions 声明 webview.create / webview.navigate。
 *
 * 使用（插件渲染层）：
 *   import { Webview, type WebviewHandle, type WebviewProps } from '@dlient-open/ui'
 *   const ref = useRef<WebviewHandle>(null)
 *   <Webview ref={ref} src="https://..." onViewReady={...} />
 */

import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react'
import { useDlientApi, type ApiResponse } from '@dlient-open/api-bridge'

export interface WebviewHandle {
  webContents: {
    call<T = unknown>(method: string, args?: unknown[]): Promise<ApiResponse<T>>
  }
}

export interface WebviewProps {
  /** 初始加载的远程页面 URL */
  src: string
  /** 透传给 WebContentsView 的 webPreferences（仅白名单字段生效，见主进程 webview-manager） */
  webPreferences?: Record<string, unknown>
  /** 是否显示（默认 true）；变化时同步主进程 WebContentsView 可见性 */
  visible?: boolean
  onDidFinishLoad?: () => void
  onDidFailLoad?: (errorCode: number, errorDescription: string, validatedURL?: string) => void
  onPageTitleUpdated?: (title: string) => void
  /** 创建成功后回调 viewId（供使用方在外部执行 executeJavaScript 等白名单方法） */
  onViewReady?: (viewId: string) => void
}

/** webview 事件负载（worker 经 push 转发） */
interface WebviewEventPayload {
  viewId: string
  name: string
  args?: unknown[]
}

export const Webview = forwardRef<WebviewHandle, WebviewProps>(function Webview(
  { src, webPreferences, visible = true, onDidFinishLoad, onDidFailLoad, onPageTitleUpdated, onViewReady },
  ref,
) {
  const api = useDlientApi()
  const elRef = useRef<HTMLDivElement>(null)
  const viewIdRef = useRef<string | null>(null)
  const handlersRef = useRef({ onDidFinishLoad, onDidFailLoad, onPageTitleUpdated, onViewReady })
  handlersRef.current = { onDidFinishLoad, onDidFailLoad, onPageTitleUpdated, onViewReady }
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // ref.webContents.call：转发到承载插件 worker → 主进程（白名单校验在主进程 webview-manager）
  useImperativeHandle(ref, () => ({
    webContents: {
      call: <T = unknown>(method: string, args: unknown[] = []) =>
        api.request<T>('webview:webContents:call', [{ viewId: viewIdRef.current, method, args }]),
    },
  }), [api])

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    let raf = 0
    let created = false
    // StrictMode 下 effect 会挂载→卸载→再挂载：create 是 RAF+async，首次 cleanup 时 viewId 尚未就绪
    // 无法销毁；用 cancelled 标记，create 返回后若组件已卸载则立即销毁刚创建的 view，防止泄漏
    let cancelled = false

    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(async () => {
        if (cancelled) return
        const r = el.getBoundingClientRect()
        const bounds = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        try {
          if (!created) {
            const res = await api.request<{ viewId?: string } | { code?: number; data?: { viewId?: string } }>('webview:create', [
              {
                src,
                bounds,
                webPreferences,
                events: ['did-finish-load', 'did-fail-load', 'page-title-updated'],
              },
            ])
            // 兼容两种响应形态：worker SDK 信封归一后为 { code, data:{viewId} }，
            // 旧/registry SDK 直接返回裸 { viewId }。只按 viewId 取值，避免误判失败导致每次 sync 重试 create（泄漏）。
            const raw = res as { viewId?: string; data?: { viewId?: string } }
            const viewId = raw.viewId ?? raw.data?.viewId
            if (viewId === undefined) {
              console.error('[webview] create failed:', res)
              return
            }
            if (cancelled) {
              // 组件已卸载（StrictMode 双挂载首实例）：销毁刚创建的 view，避免 WebContentsView 泄漏
              void api.request('webview:destroy', [viewId]).catch(() => undefined)
              return
            }
            created = true
            viewIdRef.current = viewId
            handlersRef.current.onViewReady?.(viewId)
            // 初始可见性校正：默认按主进程 owner 规则（owner === 当前活动插件可见），
            // 组件 visible=false 时立即隐藏（WebContentsView 是独立窗口层，不随 DOM 显隐）
            if (!visibleRef.current) {
              await api.request('webview:setVisible', [{ viewId, visible: false }]).catch(() => undefined)
            }
          } else {
            // 容器 0×0（宿主层 display:none 隐藏中）：跳过 bounds 更新，
            // 避免把 webContents 缩到 0×0 导致恢复可见时页面重载（保持最后有效尺寸，主进程仅移除视图）
            if (bounds.width === 0 && bounds.height === 0) return
            const res = await api.request<{ code?: number }>('webview:update', [{ viewId: viewIdRef.current, bounds }])
            const code = res && typeof res === 'object' ? (res as { code?: number }).code : undefined
            if (typeof code === 'number' && code !== 0) console.error('[webview] update failed:', res)
          }
        } catch (err) {
          console.error('[webview] sync failed:', err)
        }
      })
    }

    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('scroll', sync, true)
    window.addEventListener('dui:resize', sync)
    sync()

    // 订阅承载插件 worker 转发来的 webContents 事件（worker push 'webview:event'）
    const unsub = api.onEvent('webview:event', (data) => {
      const event = data as WebviewEventPayload
      if (!event || event.viewId !== viewIdRef.current) return
      const h = handlersRef.current
      if (event.name === 'did-finish-load') h.onDidFinishLoad?.()
      if (event.name === 'did-fail-load') h.onDidFailLoad?.(Number(event.args?.[0]), String(event.args?.[1] ?? ''), event.args?.[2] as string | undefined)
      if (event.name === 'page-title-updated') h.onPageTitleUpdated?.(String(event.args?.[0] ?? ''))
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('dui-resize', sync)
      unsub()
      if (viewIdRef.current) {
        void api.request('webview:destroy', [viewIdRef.current]).catch(() => undefined)
        viewIdRef.current = null
      }
    }
  }, [api, src, webPreferences])

  // visible 变化 → 同步主进程可见性（viewId 就绪后生效；初始值在 create 成功后校正）
  useEffect(() => {
    if (!viewIdRef.current) return
    void api.request('webview:setVisible', [{ viewId: viewIdRef.current, visible }]).catch(() => undefined)
  }, [api, visible])

  return <div ref={elRef} style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }} />
})

export default Webview
