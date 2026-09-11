/**
 * Webview - 宿主 UI 库的内嵌网页组件（@dlient-open/ui）。
 *
 * 职责：渲染占位容器 + 测量 bounds，把位置/尺寸、生命周期事件、webContents 白名单方法调用
 * 经 WebviewClient（由 PluginView 注入，绑定本视图身份）直连 preload → 主进程 WebContentsView
 * （webview-manager）。插件无需在 manifest 声明 webview 权限；约束来自两层：
 *   1) 视图身份（preload 验签）—— 同进程内其它插件无法冒充本视图；
 *   2) 创建者归属（主进程）—— 只有创建该 webview 的视图能操作 / 回收它。
 * webContents 事件由主进程按「创建者视图」推送 'webview:event'，本组件用 api.onEvent 订阅。
 *
 * 使用（插件渲染层）：
 *   import { Webview, type WebviewHandle, type WebviewProps } from '@dlient-open/ui'
 *   const ref = useRef<WebviewHandle>(null)
 *   <Webview ref={ref} src="https://..." onViewReady={...} />
 */

import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react'
import { useDlientApi, type ApiResponse } from '@dlient-open/api-bridge'
import { useWebviewClient } from './webview-client'

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
  /** 创建成功后回调 webview id（供使用方在外部执行 executeJavaScript 等白名单方法） */
  onViewReady?: (viewId: string) => void
}

/** webview 事件负载（主进程经 'webview:event' 按创建者视图定向推送） */
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
  const client = useWebviewClient()
  const elRef = useRef<HTMLDivElement>(null)
  const viewIdRef = useRef<string | null>(null)
  const handlersRef = useRef({ onDidFinishLoad, onDidFailLoad, onPageTitleUpdated, onViewReady })
  handlersRef.current = { onDidFinishLoad, onDidFailLoad, onPageTitleUpdated, onViewReady }
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // ref.webContents.call：白名单方法（executeJavaScript 等）直连主进程；白名单校验在 webview-manager
  useImperativeHandle(ref, () => ({
    webContents: {
      call: <T = unknown>(method: string, args: unknown[] = []): Promise<ApiResponse<T>> => {
        const id = viewIdRef.current
        if (!client || !id) {
          return Promise.resolve({
            code: -32601,
            msg: 'webview not ready',
            data: null,
          } as unknown as ApiResponse<T>)
        }
        return client.call<T>(id, method, args) as unknown as Promise<ApiResponse<T>>
      },
    },
  }), [client])

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    if (!client) {
      // 组件必须渲染在 PluginView 子树内（client 由 PluginView 按视图身份注入）
      console.error('[webview] missing webview client: <Webview> must be rendered inside a PluginView')
      return
    }
    let raf = 0
    let created = false
    // create 是异步的（rAF + 宿主验签往返）：await 期间 ResizeObserver / scroll 会再次进入 sync，
    // 不加锁就会重复走 create 分支 → 建出第二个 WebContentsView。首个实例随即失去引用但仍挂在窗口层
    // （宿主 create 即 addChildView），窗口尺寸变化（如全屏）后其残留 bounds 不再被当前布局遮住就露出来。
    let creating = false
    // StrictMode 下 effect 会挂载→卸载→再挂载：create 是 RAF+async，首次 cleanup 时 viewId 尚未就绪
    // 无法回收；用 cancelled 标记，create 返回后若组件已卸载则立即销毁刚创建的 webview，防止泄漏
    let cancelled = false

    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(async () => {
        if (cancelled) return
        const r = el.getBoundingClientRect()
        const bounds = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        try {
          if (!created) {
            // 创建在途：本次直接返回（尺寸变化由创建完成后的补同步兜住）
            if (creating) return
            creating = true
            let ok = false
            try {
              const res = await client.create({
                src,
                bounds,
                webPreferences,
                events: ['did-finish-load', 'did-fail-load', 'page-title-updated'],
              })
              const viewId = res?.data?.viewId
              if (typeof viewId !== 'string' || !viewId) {
                console.error('[webview] create failed:', res)
                return
              }
              if (cancelled) {
                // 组件已卸载（StrictMode 双挂载首实例）：销毁刚创建的 webview，避免 WebContentsView 泄漏
                void client.destroy(viewId).catch(() => undefined)
                return
              }
              created = true
              ok = true
              viewIdRef.current = viewId
              handlersRef.current.onViewReady?.(viewId)
              // 初始可见性校正：默认按主进程 owner 规则（owner === 当前活动应用可见），
              // 组件 visible=false 时立即隐藏（WebContentsView 是独立窗口层，不随 DOM 显隐）
              if (!visibleRef.current) {
                await client.setVisible(viewId, false).catch(() => undefined)
              }
            } finally {
              creating = false
            }
            // 创建期间的尺寸变化已被上面的 creating 短路掉（那一刻量到的 bounds 可能已过期），
            // 补一次 sync 走 update 分支校正，避免视图停在旧尺寸/旧位置
            if (ok) sync()
          } else {
            // 容器 0×0（宿主层 display:none 隐藏中）：跳过 bounds 更新，
            // 避免把 webContents 缩到 0×0 导致恢复可见时页面重载（保持最后有效尺寸，主进程仅移除视图）
            if (bounds.width === 0 && bounds.height === 0) return
            const id = viewIdRef.current
            if (!id) return
            const res = await client.update(id, bounds)
            if (res && typeof res.code === 'number' && res.code !== 0) console.error('[webview] update failed:', res)
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

    // 订阅主进程按创建者视图推送的 webContents 事件
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
      window.removeEventListener('dui:resize', sync)
      unsub()
      if (viewIdRef.current) {
        // 正常情况下这次回收会成功；若因视图注销时序失败，主进程会在 UNSET_VIEW 时按创建者兜底回收
        void client.destroy(viewIdRef.current).catch(() => undefined)
        viewIdRef.current = null
      }
    }
  }, [api, client, src, webPreferences])

  // visible 变化 → 同步主进程可见性（viewId 就绪后生效；初始值在 create 成功后校正）
  useEffect(() => {
    if (!client || !viewIdRef.current) return
    void client.setVisible(viewIdRef.current, visible).catch(() => undefined)
  }, [client, visible])

  return <div ref={elRef} style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }} />
})

export default Webview
