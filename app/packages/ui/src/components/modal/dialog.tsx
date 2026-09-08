import type { CSSProperties, ReactNode } from 'react'
import { DialogPlugin as OpenDialog, type DialogInstance } from '../ui/dialog-plugin'
import { I18nProvider } from '@dlient-open/i18n'
import { PluginApiContext, type PluginApi } from '@dlient-open/api-bridge'
import { pluginScopeId } from '../../lib/plugin-portal'
import { ensureModalStyles } from './styles'

/**
 * 统一上下文包裹（弹窗经 DialogPlugin 渲染到独立 root，context 不穿透）。
 * - I18nProvider 基于 @dlient-open/i18n store 单例（useSyncExternalStore），无需参数，任何场景安全；
 * - PluginApiContext 需要 api 值（模块级函数读不到 React context），由插件调用方经 options.api 显式传入；
 * - 不传 api（宿主自身用法）时跳过 PluginApiContext，行为与旧版完全一致。
 */
export function withContext(node: ReactNode, api?: PluginApi): ReactNode {
  if (node == null || node === false) return node
  const wrapped = <I18nProvider>{node}</I18nProvider>
  return api ? <PluginApiContext.Provider value={api}>{wrapped}</PluginApiContext.Provider> : wrapped
}

/**
 * 吸顶通用弹框的配置。
 * 未列出的行为与新 DialogPlugin 保持一致。
 */
export interface DialogOptions {
  /** 头部内容。自定义节点，内边距固定 20px；不传则不渲染头部 */
  header?: ReactNode
  /** 内容区。零内边距，需要留白请自行在内容里加 */
  body?: ReactNode
  /** 内容区别名，与 body 等价（body 优先） */
  children?: ReactNode
  /** 底部内容。不传则不渲染底部；无默认按钮 */
  footer?: ReactNode
  /** 右上角关闭按钮：true 默认图标 / false 隐藏 / ReactNode 自定义 */
  closeBtn?: boolean | ReactNode
  /** 宽度，默认 800 */
  width?: string | number
  /**
   * 高度。不传时为「最大高度 = 视口 2/3」，内容超出后内容区滚动；
   * 传入则固定为该高度
   */
  height?: string | number
  /** 距顶距离，默认 0px（吸顶） */
  top?: string | number
  /** 位置，默认 top（吸顶）；传 center 则垂直居中 */
  placement?: 'top' | 'center'
  /** 点击遮罩是否关闭，默认 false */
  closeOnOverlayClick?: boolean
  /** 按 ESC 是否关闭，默认 false */
  closeOnEscKeydown?: boolean
  /** 是否显示遮罩，默认 true */
  showOverlay?: boolean
  /** 关闭弹框时是否销毁内部元素，默认 true */
  destroyOnClose?: boolean
  /** 是否可拖拽，默认 false */
  draggable?: boolean
  /** 挂载节点，默认 body */
  attach?: string | (() => Element)
  /** 追加到最外层容器的类名 */
  className?: string
  /** 卡片本体的类名 */
  dialogClassName?: string
  /** 卡片本体的行内样式 */
  style?: CSSProperties
  /** 层级 */
  zIndex?: number
  /**
   * 插件实例 API（插件调用方在 PluginView 内 useDlientApi() 取得后传入）。
   * 传入后 header/body/footer 自动包进 PluginApiContext.Provider（+ I18nProvider），
   * 弹窗内 useDlientApi()/useI18n() 直接可用；宿主自身不传时行为不变。
   */
  api?: PluginApi
  /** 关闭回调（关闭按钮 / 遮罩 / ESC），任意途径只触发一次 */
  onClose?: (ctx: DialogContext) => void
  /** 弹出动画结束后触发 */
  onOpened?: () => void
  /** 消失动画结束后触发 */
  onClosed?: () => void
}

export interface DialogContext {
  /** 弹框实例 */
  instance: DialogInstance
  /** 关闭并销毁 */
  close: () => void
}

/** 弹框实例，额外挂一个与 onClose 同源的 close */
export interface DuiDialogInstance extends DialogInstance {
  /** 关闭并销毁，与内部关闭途径共用同一个幂等出口 */
  close: () => void
}

/* ------------------------------------------------------------------ */

/**
 * 吸顶通用弹框。
 *
 * 与反馈弹框（modal.info / confirm 等）的区别：
 * - 内容区零 padding，完全交给调用方排版
 * - header / body / footer 三段均可自定义，header 内边距固定 20px
 * - 默认宽 800，默认最大高度为视口 2/3，超出后内容区滚动
 */
export function createDialog(opts: DialogOptions = {}): DuiDialogInstance {
  ensureModalStyles()
  // 方案 B 作用域：modal.dialog 的 header/body/footer 全为插件自定义内容，各自带 data-plugin；
  // 遮罩 / 卡片 / 关闭按钮（DialogPlugin chrome）保持全局。
  const scopeId = opts.api?.pluginId ? pluginScopeId(opts.api.pluginId) : undefined
  // 关闭按钮 / 遮罩 / ESC 可能叠加触发，收敛为一次
  let closed = false

  let instance!: DialogInstance

  const close = () => {
    if (closed) return
    closed = true
    instance.destroy()
  }

  const ctx = (): DialogContext => ({ instance, close })

  const handleClose = () => {
    if (closed) return
    closed = true
    instance.destroy()
    opts.onClose?.(ctx())
  }

  // header/body/footer 统一经 withContext 包裹（I18nProvider + 可选 PluginApiContext）
  const body = withContext(
    <div className="dui-modal-dialog__content" data-plugin={scopeId}>{opts.body ?? opts.children}</div>,
    opts.api,
  )
  const header = opts.header != null && opts.header !== false
    ? withContext(<div className="dui-modal-dialog__header" data-plugin={scopeId}>{opts.header}</div>, opts.api)
    : undefined
  const footer = opts.footer != null && opts.footer !== false
    ? withContext(<div className="dui-modal-dialog__footer" data-plugin={scopeId}>{opts.footer}</div>, opts.api)
    : undefined

  // 传了 height 固定高，否则用 max-height 限制在视口 2/3
  const sizeStyle: CSSProperties =
    opts.height != null
      ? { height: typeof opts.height === 'number' ? `${opts.height}px` : opts.height }
      : {}

  // 关闭按钮 / 遮罩 / ESC 会触发 onClose 与 destroy（由新 DialogPlugin 内部处理）
  instance = OpenDialog({
    header: header ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>{header}</div> : undefined,
    body: <div className="dui-dialog__body-scroll">{body}</div>,
    footer,
    closeBtn: opts.closeBtn ?? true,
    width: opts.width ?? 800,
    placement: opts.placement ?? 'top',
    top: opts.top ?? 0,
    closeOnOverlayClick: opts.closeOnOverlayClick ?? false,
    closeOnEscKeydown: opts.closeOnEscKeydown ?? false,
    showOverlay: opts.showOverlay ?? true,
    destroyOnClose: opts.destroyOnClose ?? true,
    draggable: opts.draggable ?? false,
    attach: opts.attach,
    zIndex: opts.zIndex,
    style: { ...sizeStyle, ...opts.style },
    className: `dui-modal-dialog${opts.className ? ` ${opts.className}` : ''}`,
    dialogClassName: `dui-modal-dialog__card${opts.height != null ? ' dui-modal-dialog__card--fixed' : ''}${opts.dialogClassName ? ` ${opts.dialogClassName}` : ''}`,
    onClose: handleClose,
    onOpened: opts.onOpened,
    onClosed: opts.onClosed,
  })

  const result = instance as DuiDialogInstance
  result.close = close
  return result
}

export default createDialog
