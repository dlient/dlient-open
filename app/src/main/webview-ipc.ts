/**
 * webview-ipc.ts - 渲染层直连 WebContentsView 的 IPC 通道（替代原 host-api 的 webview.*）。
 *
 * 鉴权模型（两层，缺一不可）：
 *  1. preload：视图身份登记（setView）+ HMAC 签名 + 时间戳新鲜度（见 src/preload/index.ts 的 verifySignature）。
 *     sign_key 只存在于 preload 闭包内，渲染层 JS（含同进程内其它插件）无法伪造 viewId ↔ pluginId 绑定。
 *  2. 主进程（本文件）：按「创建者视图」做归属校验 —— 只有创建该 webview 的视图才能 update / destroy /
 *     setVisible / call；hideMine / showMine 按调用方插件匹配 owner。
 *
 * 与旧 host-api 链路的差异：
 *  - 少两跳（不再经插件 worker 转发），且 viewId 不再丢失 —— 「组件卸载 → 回收」因此有了可靠兜底
 *    （UNSET_VIEW → destroyByView，见 bridge.ts）；
 *  - 插件无需在 manifest 声明 webview 权限。硬约束仍全部保留在 webview-manager：
 *    沙箱（sandbox/contextIsolation/nodeIntegration:false）+ webPreferences 白名单 + webContents 方法白名单 + 事件白名单。
 *
 * 载荷约定：payload.viewId = 调用者视图 id（身份，preload 已验签）；payload.webviewId = 被操作的 WebContentsView id。
 */
import { ipcMain } from 'electron'
import {
  webviewCreate,
  webviewDescribe,
  webviewDestroy,
  webviewHideByPlugin,
  webviewSetVisible,
  webviewShowByPlugin,
  webviewUpdate,
  webviewWebContentsCall,
} from './lib/webview'

const CHANNEL = 'webview'

interface WebviewPayload {
  /** 调用者视图 id（身份；preload 已按此验签） */
  viewId?: string
  /** 调用方插件 id（preload 已与视图登记比对一致） */
  pluginId?: string
  /** 被操作的 WebContentsView id（create 返回值） */
  webviewId?: string
  timestamp?: number
  signature?: string
  [key: string]: unknown
}

const str = (v: unknown): string => String(v ?? '')

/** 仅「创建该 webview 的视图」可操作它（防同/跨插件伪造 webviewId） */
function assertCreator(webviewId: string, callerViewId: string): void {
  const d = webviewDescribe(webviewId)
  if (!d) throw new Error(`webview not found: ${webviewId}`)
  if (d.createdByViewId !== callerViewId) throw new Error('not the creator of this webview')
}

export function registerWebviewIpc(): void {
  // 创建：记录创建者视图（用于精确回收 + 事件定向推送）；owner 仍由 manager 按当前活动应用判定
  ipcMain.handle(`${CHANNEL}:create`, (_event, payload: WebviewPayload) => {
    const callerViewId = str(payload?.viewId)
    if (!callerViewId) throw new Error('invalid view identity')
    const { viewId: _v, pluginId: _p, timestamp: _t, signature: _s, webviewId: _w, ...opts } = payload
    return webviewCreate({ ...opts, createdByViewId: callerViewId })
  })

  ipcMain.handle(`${CHANNEL}:update`, (_event, payload: WebviewPayload) => {
    const webviewId = str(payload?.webviewId)
    assertCreator(webviewId, str(payload?.viewId))
    webviewUpdate({ viewId: webviewId, bounds: payload?.bounds })
  })

  ipcMain.handle(`${CHANNEL}:destroy`, (_event, payload: WebviewPayload) => {
    const webviewId = str(payload?.webviewId)
    assertCreator(webviewId, str(payload?.viewId))
    webviewDestroy(webviewId)
  })

  ipcMain.handle(`${CHANNEL}:setVisible`, (_event, payload: WebviewPayload) => {
    const webviewId = str(payload?.webviewId)
    assertCreator(webviewId, str(payload?.viewId))
    webviewSetVisible({ viewId: webviewId, visible: payload?.visible !== false })
  })

  // webContents 白名单方法调用（executeJavaScript 等）；方法白名单在 manager 内校验
  ipcMain.handle(`${CHANNEL}:call`, (_event, payload: WebviewPayload) => {
    const webviewId = str(payload?.webviewId)
    assertCreator(webviewId, str(payload?.viewId))
    return webviewWebContentsCall({ viewId: webviewId, method: payload?.method, args: payload?.args })
  })

  // 按插件显示/隐藏 webview（owner 匹配调用方插件；返回值 = 本次实际隐藏的 webview id 列表）
  ipcMain.handle(`${CHANNEL}:hideMine`, (_event, payload: WebviewPayload) => {
    return webviewHideByPlugin(str(payload?.pluginId))
  })
  ipcMain.handle(`${CHANNEL}:showMine`, (_event, payload: WebviewPayload) => {
    const views = Array.isArray(payload?.views) ? (payload.views as string[]) : undefined
    webviewShowByPlugin(views, str(payload?.pluginId))
  })
}
