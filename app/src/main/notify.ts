/**
 * notify.ts - NOTIFY 事件通知总线（宿主 → 渲染层，docs/specs/plugin-permission.md §7）。
 *
 * 载荷：{ event, event_id, receiver, data, from }。
 * receiver 语义：
 *  - 'all'：全部插件 + 宿主渲染端；
 *  - '<pluginId>'（可多个）：定向插件；
 *  - '@<org>'：指定组织的插件（org 取自 manifest，宿主注入，插件不可自报）；
 *  - '__render'：仅宿主渲染端（宿主保留；插件经 app.notify 发送时会被剥离）。
 *
 * 宿主主进程向所有主窗口 webContents 广播；渲染层按监听者 role/plugin_id/org 匹配 receiver 后分发。
 */

import type { WebContents } from 'electron'
import { RendererChannels } from '@dlient-open/core'

export interface NotifyPayload {
  event: string
  event_id: string
  receiver: string[]
  data?: unknown
  /** 来源：插件 id（宿主内部通知缺省） */
  from?: string
}

let getTargets: (() => WebContents[] | null) | null = null

/** 注册通知目标（主进程装配：主窗口 webContents 集合） */
export function registerNotifyTargets(fn: () => WebContents[] | null): void {
  getTargets = fn
}

/** 向渲染层广播 NOTIFY（所有目标窗口；被销毁的跳过） */
export function broadcastNotify(payload: NotifyPayload): void {
  const targets = getTargets?.() ?? []
  for (const wc of targets) {
    if (!wc.isDestroyed()) wc.send(RendererChannels.NOTIFY, payload)
  }
}

/** receiver 匹配（监听者 role/plugin_id/org 由宿主注入；与 spec §7.3 checkReceiver 一致） */
export function checkReceiver(
  listener: { role: 'plugin' | 'render'; plugin_id?: string; org?: string },
  receivers: string[],
): boolean {
  if (receivers.includes('all')) return true
  if (listener.role === 'render' && receivers.includes('__render')) return true
  if (listener.role === 'plugin') {
    if (listener.plugin_id && receivers.includes(listener.plugin_id)) return true
    if (listener.org && receivers.includes(`@${listener.org}`)) return true
  }
  return false
}
