/**
 * lib/webview.ts - webview 模块复杂实现（方案 v2：webview 编排下沉 lib；api/webview.ts 引用）。
 * WebContentsView 实例统一由 WebviewManager 管理（webview-manager.ts），此处仅转发。
 */
import type { WebviewManager } from '../webview-manager'

let getManager: () => WebviewManager | null = () => null

/** 宿主装配注入 WebviewManager getter（index.ts registerWebviewManager 调用） */
export function registerWebviewManagerGetter(get: () => WebviewManager | null): void {
  getManager = get
}

/** 宿主装配注入 WebviewManager（无头模式 webview 承载；原 export.ts 同名函数迁移至此） */
export function registerWebviewManager(manager: WebviewManager | null): void {
  getManager = () => manager
}

export function webviewCreate(opts: unknown): unknown {
  return getManager()?.create(opts ?? {})
}

export function webviewUpdate(opts: unknown): void {
  const { viewId, bounds } = (typeof opts === 'object' && opts !== null ? opts : {}) as {
    viewId?: string
    bounds?: unknown
  }
  getManager()?.update(String(viewId ?? ''), bounds)
}

export function webviewDestroy(viewId: unknown): void {
  getManager()?.destroy(String(viewId ?? ''))
}

export function webviewSetVisible(opts: unknown): void {
  const { viewId, visible } = (typeof opts === 'object' && opts !== null ? opts : {}) as {
    viewId?: string
    visible?: boolean
  }
  getManager()?.setVisible(String(viewId ?? ''), !!visible)
}

/** 批量销毁某插件归属的全部 webview（dev-runtime 顶层 tab 切换兜底清理） */
export function webviewDestroyByOwner(pluginId: unknown): void {
  getManager()?.destroyByOwner(String(pluginId ?? ''))
}

export function webviewGetActivePlugin(): unknown {
  return getManager()?.getActivePlugin() ?? null
}

export function webviewShowByPlugin(views: unknown, pluginId: string): void {
  getManager()?.showWebviewByPlugin(String(pluginId ?? ''), Array.isArray(views) ? (views as string[]) : undefined)
}

export function webviewHideByPlugin(pluginId: string): string[] {
  return (getManager()?.hideWebviewByPlugin(String(pluginId ?? '')) ?? []) as string[]
}

export function webviewSetActivePlugin(pluginId: unknown): void {
  getManager()?.setActivePlugin(pluginId == null ? null : String(pluginId))
}

export function webviewWebContentsCall(opts: unknown): unknown {
  return getManager()?.webContentsCall(opts ?? {})
}
