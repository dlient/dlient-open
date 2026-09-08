/**
 * notify-viewer.ts - 内置通知条视图（P3，docs/specs/notification-v2.md §4.5）。
 *
 * 形态：独立透明 WebContentsView（复用 dialog 安全形态：sandbox preload + sender 校验），
 * 加载 app/notify/index.html，展示在应用右上角（不占满屏、内容驱动尺寸）。
 *
 * 展示策略（评审已定）：
 *  - 单视图堆叠（所有通知一个 WebContentsView）；
 *  - 新到置顶（新通知/新组插入顶部，旧的下移）；
 *  - 同组折叠（同 group_id 合并为一张卡 +N，展开逐条）；
 *  - 数量上限 MAX_STACK=3，区域满时新组进入 FIFO 队列，有组移除后补位；
 *  - 尺寸收敛：宽度固定、高度由页面 ResizeObserver 上报（首次回报后 show()，maxHeight 截断，zoomFactor=1）。
 *  - 驻留规则：有交互（actions/hasReply）或 timeoutType='never' 时驻留；否则默认时长自动关闭。
 *
 * 层级：与 dialog 授权视图均为独立单例；z 序规则见 §4.5（待决项：默认本视图在 show 时置顶）。
 */
import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron'
import path from 'node:path'
import { RendererChannels } from '@dlient-open/core'
import { getCurrentTheme } from './lib/theme'
import { getMainLocale } from './i18n'
import type { NotificationEventName, NotifyViewerLike } from './api/notification'

/** 通知条展示数据（主进程栈内条目） */
export interface NotifyViewItem {
  id: string
  owner: string
  group_id: string
  title: string
  body: string
  subtitle?: string
  icon?: string
  hasReply: boolean
  replyPlaceholder?: string
  actions: { type: 'button' | 'reply'; text: string }[]
  closeButtonText?: string
  timeoutType: 'default' | 'never'
}

export interface NotifyViewerOptions {
  getWindow: () => BrowserWindow | null
  /** 交互/超时事件回推（id, event, payload）→ 主进程 notification 注册表 */
  onEvent: (id: string, event: NotificationEventName, payload?: { index?: number; reply?: string; error?: string }) => void
}

/** 展示栈条目（同 group 折叠为一个组） */
interface GroupEntry {
  group_id: string
  items: NotifyViewItem[]
}

const CARD_WIDTH = 360
const MARGIN = 12
/** 同时展示的最大组数（溢出进 FIFO 队列） */
const MAX_STACK = 3
/** 无交互且非 never 时的自动消失时长 */
const AUTO_DISMISS_MS = 6000
/** 通知条高度上限（可视区比例；超出时页面内滚动） */
const MAX_HEIGHT_RATIO = 0.8

export function createNotifyViewer(opts: NotifyViewerOptions): NotifyViewerLike {
  let view: WebContentsView | null = null

  /** 展示栈（新到置顶；同 group 折叠） */
  let groups: GroupEntry[] = []
  /** 溢出 FIFO（组级；区域有空位时补位） */
  const queue: GroupEntry[] = []
  /** 自动消失定时器（item id → timer；驻留项不设） */
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 页面上报内容高度（px；bounds 高度） */
  let contentHeight = 0
  /** 已就绪（页面 ready 握手前 pushSet 挂起） */
  let pageReady = false
  let pendingDirty = false
  /** 视图可见状态（WebContentsView 无 isVisible()，本地记账） */
  let viewVisible = false

  function pageData() {
    return {
      theme: getCurrentTheme(),
      locale: getMainLocale(),
      groups: groups.map((g) => ({
        group_id: g.group_id,
        count: g.items.length,
        items: g.items.map((it) => ({
          id: it.id,
          title: it.title,
          body: it.body,
          subtitle: it.subtitle,
          icon: it.icon,
          hasReply: it.hasReply,
          replyPlaceholder: it.replyPlaceholder,
          actions: it.actions,
          closeButtonText: it.closeButtonText,
        })),
      })),
    }
  }

  function ensureView(): WebContentsView {
    if (view && !view.webContents.isDestroyed()) return view
    const win = opts.getWindow()
    if (!win) throw new Error('notify-viewer: main window not available')

    const v = new WebContentsView({
      webPreferences: {
        preload: path.join(app.getAppPath(), 'notify', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        transparent: true,
        backgroundThrottling: false,
        zoomFactor: 1,
      },
    })
    v.setBackgroundColor('#00000000')

    // 就绪握手（页面 preload ready()）
    ipcMain.on(RendererChannels.NOTIFY_VIEW_READY, (event) => {
      if (v.webContents.isDestroyed() || event.sender.id !== v.webContents.id) return
      pageReady = true
      if (pendingDirty) {
        pendingDirty = false
        pushSet()
      }
    })

    // 交互回传：校验 sender 必须为本视图
    ipcMain.on(RendererChannels.NOTIFY_VIEW_EVENT, (event, payload) => {
      if (v.webContents.isDestroyed() || event.sender.id !== v.webContents.id) return
      const p = (payload ?? {}) as { id?: unknown; event?: unknown; payload?: unknown }
      const id = String(p.id ?? '')
      const ev = String(p.event ?? '')
      if (!id || !ev) return
      const extra = (p.payload ?? {}) as { index?: number; reply?: string; error?: string }
      handleViewEvent(id, ev as NotificationEventName, extra)
    })

    // 尺寸上报：内容高度收敛（宽度固定）
    ipcMain.on(RendererChannels.NOTIFY_VIEW_RESIZE, (event, payload) => {
      if (v.webContents.isDestroyed() || event.sender.id !== v.webContents.id) return
      const h = Number((payload as { height?: unknown } | null)?.height ?? 0)
      if (!Number.isFinite(h)) return
      contentHeight = Math.max(0, Math.floor(h))
      positionView()
    })

    win.on('resize', () => positionView())
    win.on('move', () => positionView())

    win.contentView.addChildView(v)
    void v.webContents.loadFile(path.join(app.getAppPath(), 'notify', 'index.html'))
    view = v
    return v
  }

  /** 右上角停靠 + 尺寸收敛（宽固定 CARD_WIDTH；高=内容高度，maxHeight 截断；首报后显示） */
  function positionView(): void {
    const win = opts.getWindow()
    if (!win || !view || view.webContents.isDestroyed()) return
    const bounds = win.getContentBounds()
    const maxH = Math.floor(bounds.height * MAX_HEIGHT_RATIO)
    const height = Math.min(Math.max(contentHeight, 1), maxH)
    view.setBounds({ x: Math.max(bounds.width - CARD_WIDTH - MARGIN, 0), y: MARGIN, width: CARD_WIDTH, height })
    if (groups.length > 0 && !viewVisible) {
      // 置顶（dialog 之后再 add 的在上；z 序待决项见 §4.5）
      try {
        win.contentView.removeChildView(view)
      } catch {
        /* 未添加忽略 */
      }
      win.contentView.addChildView(view)
      view.setVisible(true)
      viewVisible = true
    }
  }

  /** 全量栈下发（页面 ready 后）；空栈 → 隐藏视图 */
  function pushSet(): void {
    const v = view
    if (!v || v.webContents.isDestroyed()) {
      pendingDirty = true
      return
    }
    if (!pageReady) {
      pendingDirty = true
      return
    }
    pendingDirty = false
    v.webContents.send(RendererChannels.NOTIFY_VIEW_SET, pageData())
    if (groups.length === 0) v.setVisible(false)
    else positionView()
  }

  function hideView(): void {
    if (!view) return
    view.setVisible(false)
    viewVisible = false
  }

  function scheduleAutoDismiss(item: NotifyViewItem): void {
    if (item.hasReply || item.actions.length > 0 || item.timeoutType === 'never') return
    const t = setTimeout(() => {
      timers.delete(item.id)
      removeItem(item.id, true)
    }, AUTO_DISMISS_MS)
    timers.set(item.id, t)
  }

  /** 移除条目（notifyClose=true 时回推 close 事件；主进程 remove/removeGroup 调 false） */
  function removeItem(id: string, notifyClose: boolean): void {
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
    let changed = false
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const g = groups[gi]
      const idx = g.items.findIndex((it) => it.id === id)
      if (idx < 0) continue
      g.items.splice(idx, 1)
      if (g.items.length === 0) groups.splice(gi, 1)
      changed = true
    }
    if (!changed) return
    refill()
    pushSet()
    if (groups.length === 0) hideView()
    if (notifyClose) opts.onEvent(id, 'close')
  }

  /** 区域有空位 → FIFO 补位（新到置顶） */
  function refill(): void {
    while (groups.length < MAX_STACK && queue.length > 0) {
      groups.unshift(queue.shift() as GroupEntry)
    }
  }

  /** 页面交互/超时回传：事件回推 + close 时移除卡片 */
  function handleViewEvent(id: string, event: NotificationEventName, payload?: { index?: number; reply?: string; error?: string }): void {
    if (event === 'close') {
      removeItem(id, true)
      return
    }
    if (event === 'action') opts.onEvent(id, 'action', { index: Number(payload?.index ?? 0) })
    else if (event === 'reply') opts.onEvent(id, 'reply', { reply: String(payload?.reply ?? '') })
    else opts.onEvent(id, event, payload)
  }

  return {
    show(item: NotifyViewItem): void {
      try {
        ensureView()
      } catch {
        return // 主窗口不可用：静默丢弃（引擎分发已尽最大努力）
      }
      const existing = groups.find((g) => g.group_id === item.group_id)
      if (existing) {
        // 同组折叠：追加到组内并置顶
        const idx = groups.indexOf(existing)
        groups.splice(idx, 1)
        existing.items.push(item)
        groups.unshift(existing)
      } else {
        const g: GroupEntry = { group_id: item.group_id, items: [item] }
        if (groups.length >= MAX_STACK) {
          queue.push(g)
        } else {
          groups.unshift(g)
        }
      }
      scheduleAutoDismiss(item)
      pushSet()
    },

    dismissById(id: string): void {
      removeItem(id, false)
    },

    dismissByOwner(owner: string): void {
      let changed = false
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const g = groups[gi]
        const before = g.items.length
        g.items = g.items.filter((it) => it.owner !== owner)
        if (g.items.length !== before) changed = true
        if (g.items.length === 0) groups.splice(gi, 1)
      }
      if (!changed) return
      refill()
      pushSet()
      if (groups.length === 0) hideView()
    },
  }
}
