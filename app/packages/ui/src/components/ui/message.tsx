import React from 'react'
import { CheckCircle2, Info, XCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from './sonner'

/**
 * MessagePlugin（命令式轻提示 toast，API 保留）。
 *
 * 方案 A 适配层：导出签名（MessagePlugin / message / MessageType / MessageInstance）保持兼容，
 * 底层实现由自研 toast 切换到 sonner（动画 / 可访问性 / 扩展能力随 sonner 获得），全仓库调用点零改动。
 *
 * 契约：调用方宿主需在根组件挂载一次 <Toaster />（@dlient-open/ui 导出，带单例守卫）。
 *   - sonner 模块加载即自动注入默认样式，Toaster 容器由宿主根提供；
 *   - sonner store 会向订阅者 replay 已创建的 toast（宿主根 mount 前的调用不丢失）。
 *
 * 行为对齐（旧语义）：
 *  - 默认 duration 2500ms（sonner 默认 4000）；
 *  - loading 不自动关闭（duration=Infinity）并显示关闭按钮；
 *  - onClose 由 onDismiss + onAutoClose 组合触发；
 *  - 位置由宿主根 Toaster 统一配置；
 *  - 主题由 sonner.tsx 的 CSS 变量（--popover/--border/--radius）自动跟随亮/暗；
 *  - 图标沿用 lucide 语义着色。
 */

export type MessageType = 'info' | 'success' | 'warning' | 'error' | 'loading'
export interface MessageOptions {
  content: React.ReactNode
  duration?: number
  onClose?: () => void
}
export interface MessageInstance {
  close: () => void
  destroy: () => void
}

const ICONS: Record<Exclude<MessageType, 'loading'>, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="dui:text-success" />,
  error: <XCircle size={16} className="dui:text-destructive" />,
  warning: <AlertTriangle size={16} className="dui:text-warning" />,
  info: <Info size={16} className="dui:text-info" />,
}

function push(type: MessageType, options: string | MessageOptions): MessageInstance {
  const opts: MessageOptions = typeof options === 'string' ? { content: options } : options
  // 兼容旧语义：默认 2500ms；loading 不自动关闭（旧实现 duration=0）
  const duration = opts.duration ?? (type === 'loading' ? Infinity : 2500)
  const handleClose = () => opts.onClose?.()

  let id: string | number
  if (type === 'loading') {
    id = toast.loading(opts.content as string, {
      icon: <Loader2 size={16} className="dui:animate-spin dui:text-muted-foreground" />,
      duration,
      closeButton: true,
      onDismiss: handleClose,
      onAutoClose: handleClose,
    })
  } else {
    id = toast(opts.content as string, {
      icon: ICONS[type],
      duration,
      closeButton: false,
      onDismiss: handleClose,
      onAutoClose: handleClose,
    })
  }
  const close = () => toast.dismiss(id)
  return { close, destroy: close }
}

export const MessagePlugin = {
  info: (content: string) => push('info', content),
  success: (content: string) => push('success', content),
  warning: (content: string) => push('warning', content),
  error: (content: string) => push('error', content),
  loading: (content?: string) => push('loading', content ?? '加载中…'),
  closeAll: () => toast.dismiss(),
}

export function message(options: string | MessageOptions, type: MessageType = 'info'): MessageInstance {
  return push(type, options)
}
export default MessagePlugin
