/**
 * dialog.ts - 宿主主进程「独立确认视图」管理（根治「确认通道与插件代码同上下文」）。
 *
 * 架构：主进程独占一个 WebContentsView（全窗口、透明背景），加载 app/dialog/index.html。
 *   - 该视图的 preload（dialog/preload.ts）只在主进程创建的视图里存在，插件代码加载不进该视图；
 *   - 确认请求（showDialog）→ DIALOG_REQUEST → 页面弹框 → 用户决策 → DIALOG_REPLY 回传；
 *   - 回传校验：event.sender 必须为本视图 webContents + requestId 命中 pending（重复/伪造忽略）；
 *   - 超时（缺省 300s）/ 视图不可用一律按「关闭(ok:false)」处理。
 *
 * 通用弹框宿主：dialog 字段区分类型（permission / confirm / delete / info …），
 * 后续扩展只需在页面 index.html 里新增 dialog 分支，主进程侧增加 showXxx 便捷方法。
 */

import { app, ipcMain, WebContentsView, type BrowserWindow } from 'electron'
import path from 'node:path'
import { RendererChannels } from '@dlient-open/core'
import { getMainLocale } from './i18n'
import { getCurrentTheme } from './lib/theme'

/** 弹框结果（页面 → 主进程） */
export interface DialogResult {
  ok: boolean
  /** 决策动作：permission=permanent/once/reject/close；message=confirm/cancel/close */
  action: string
  scope?: 'persistent' | 'session'
  payload?: unknown
}

/** 权限弹框条目（与页面 dl-perm 卡片对应：kind 标签 / reason 说明 / scope 范围行） */
export interface PermissionDialogItem {
  kind?: string
  reason?: string
  scope?: string[]
  /** 图标类型：fs / net / cmd / log / plugin（缺省按 kind/method 文本推断） */
  icon?: string
  /** 直接可加载的图标 URL（如目标插件 dlientV3://plugin/<id>/<icon>；优先于 icon 类型） */
  iconSrc?: string
  method?: string
}

export interface PermissionDialogData {
  title?: string
  fromName?: string
  items: PermissionDialogItem[]
  /** 是否展示「允许本次 / 永久授权」作用域三选（缺省仅「允许/拒绝」） */
  canScope?: boolean
  batch?: boolean
}

export interface DialogManagerOptions {
  getWindow: () => BrowserWindow | null
  /** 确认超时 ms（缺省 300s；超时按关闭处理） */
  timeoutMs?: number
}

const DIALOG_TIMEOUT_MS = 300_000

export interface DialogManager {
  /** 通用弹框：dialog 类型 + 数据 → 用户决策结果 */
  showDialog(dialog: string, data: unknown): Promise<DialogResult>
  /** 权限确认弹框（授权体系主入口） */
  showPermissionDialog(data: PermissionDialogData): Promise<DialogResult>
  /** 关闭当前弹框（隐藏视图；不销毁，复用） */
  close(): void
  dispose(): void
}

export function createDialogManager(opts: DialogManagerOptions): DialogManager {
  const timeoutMs = opts.timeoutMs ?? DIALOG_TIMEOUT_MS
  const pending = new Map<number, { resolve: (r: DialogResult) => void; timer: ReturnType<typeof setTimeout> }>()
  let seq = 0
  let view: WebContentsView | null = null
  let readyResolve: (() => void) | null = null
  let readyPromise: Promise<void> | null = null

  function ensureView(): WebContentsView {
    if (view && !view.webContents.isDestroyed()) return view
    const win = opts.getWindow()
    if (!win) throw new Error('dialog: main window not available')

    const v = new WebContentsView({
      webPreferences: {
        // dialog/preload.js 与 index.html 同目录静态打包（沙箱 preload：仅 electron 子集，无构建步骤）
        preload: path.join(app.getAppPath(), 'dialog', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        transparent: true,
        backgroundThrottling: false,
      },
    })
    // 透明背景：视图全窗口铺开，页面 mask(rgba) 负责压暗底层，卡片居中
    v.setBackgroundColor('#00000000')

    // 就绪握手：页面 preload ready / did-finish-load 双保险，避免请求早于订阅丢失
    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve
    })
    v.webContents.on('did-finish-load', () => {
      readyResolve?.()
      readyResolve = null
    })

    // 回传：校验 sender 必须为本视图 + requestId 命中 pending（防伪造/重放）
    ipcMain.on(RendererChannels.DIALOG_REPLY, (event, result) => {
      if (v.webContents.isDestroyed() || event.sender.id !== v.webContents.id) return
      const requestId = Number((result as { requestId?: unknown })?.requestId)
      const rec = pending.get(requestId)
      if (!rec) return
      clearTimeout(rec.timer)
      pending.delete(requestId)
      rec.resolve({
        ok: (result as { ok?: unknown })?.ok === true,
        action: String((result as { action?: unknown })?.action ?? 'close'),
        scope: (result as { scope?: unknown })?.scope === 'session' ? 'session' : 'persistent',
        payload: (result as { payload?: unknown })?.payload,
      })
      maybeHideView()
    })

    // 就绪握手回执（页面 preload ready()）
    ipcMain.on(RendererChannels.DIALOG_READY, (event) => {
      if (v.webContents.isDestroyed() || event.sender.id !== v.webContents.id) return
      readyResolve?.()
      readyResolve = null
    })

    // 窗口缩放/移动时跟随定位（弹框保持居中铺满）
    win.on('resize', () => positionView())
    win.on('move', () => positionView())

    win.contentView.addChildView(v)
    void v.webContents.loadFile(path.join(app.getAppPath(), 'dialog', 'index.html'))
    view = v
    return v
  }

  function positionView(): void {
    const win = opts.getWindow()
    if (!win || !view) return
    // WebContentsView 的 bounds 是相对窗口内容区的坐标（左上角恒为 0,0）。
    // 只取 getContentBounds() 的宽高；若把 x/y（屏幕坐标）一并传入会导致视图错位、占不满窗口。
    const bounds = win.getContentBounds()
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  }

  /** 最后一个 pending 结束后延迟隐藏确认视图：释放主窗口输入（多弹框栈在页面内维护）。
   *  延迟 250ms 对齐页面收起动画（220ms），避免淡出动画被截断。 */
  function maybeHideView(): void {
    if (pending.size > 0 || !view) return
    setTimeout(() => {
      if (pending.size === 0 && view && !view.webContents.isDestroyed()) view.setVisible(false)
    }, 250)
  }

  function showDialog(dialog: string, data: unknown): Promise<DialogResult> {
    const v = ensureView()
    return (readyPromise ?? Promise.resolve()).then(() => {
      const win = opts.getWindow()
      positionView()
      // 置顶：重新 addChildView 使确认视图位于最上层（插件 webview 之后创建的也不盖住确认框）
      if (win) {
        try {
          win.contentView.removeChildView(v)
        } catch {
          /* 未添加过忽略 */
        }
        win.contentView.addChildView(v)
      }
      v.setVisible(true)
      v.webContents.focus()
      const requestId = ++seq
      const result = new Promise<DialogResult>((resolve) => {
        const timer = setTimeout(() => {
          if (!pending.has(requestId)) return
          pending.delete(requestId)
          resolve({ ok: false, action: 'close' })
          // 通知页面按 requestId 移除弹框 DOM（页面无决策回调，主进程超时需主动清理，防残留泄漏）
          if (!v.webContents.isDestroyed()) v.webContents.send(RendererChannels.DIALOG_CLOSE, { requestId })
          maybeHideView()
        }, timeoutMs)
        pending.set(requestId, { resolve, timer })
      })
      v.webContents.send(RendererChannels.DIALOG_REQUEST, {
        requestId,
        dialog,
        theme: getCurrentTheme(),
        locale: getMainLocale(),
        data,
      })
      return result
    })
  }

  function showPermissionDialog(data: PermissionDialogData): Promise<DialogResult> {
    return showDialog('permission', data)
  }

  function close(): void {
    view?.setVisible(false)
  }

  function dispose(): void {
    pending.forEach((rec) => {
      clearTimeout(rec.timer)
      rec.resolve({ ok: false, action: 'close' })
    })
    pending.clear()
    if (view) {
      try {
        opts.getWindow()?.contentView.removeChildView(view)
      } catch {
        /* 已移除忽略 */
      }
      if (!view.webContents.isDestroyed()) view.webContents.close()
      view = null
    }
  }

  return { showDialog, showPermissionDialog, close, dispose }
}
