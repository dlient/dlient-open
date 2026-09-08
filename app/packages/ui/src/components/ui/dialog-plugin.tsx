import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { X } from 'lucide-react'
import { ensureUiStyles } from './styles'
import { cn } from '../../lib/utils'
import { PluginApiContext, type PluginApi } from '@dlient-open/api-bridge'
import { I18nProvider } from '@dlient-open/i18n'
import { pluginScopeId } from '../../lib/plugin-portal'

/**
 * 命令式弹窗（DialogPlugin 兼容，tdesign API）：挂载到 body，返回 { update, destroy, close }。
 * 命令式自绘实现：ESC / 遮罩行为由本组件自行处理（关闭逻辑收敛在 close()）。
 * 视觉走包内自包含 shadcn 语义变量（dui-dialog-* 基础类定义于本包 ui.css @layer）。
 */

export interface DialogOptions {
  header?: React.ReactNode
  body?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  closeBtn?: boolean | React.ReactNode
  width?: string | number
  height?: string | number
  top?: string | number
  placement?: 'top' | 'center'
  closeOnOverlayClick?: boolean
  closeOnEscKeydown?: boolean
  showOverlay?: boolean
  destroyOnClose?: boolean
  draggable?: boolean
  attach?: string | (() => Element)
  zIndex?: number
  className?: string
  dialogClassName?: string
  style?: React.CSSProperties
  /**
   * 插件实例 API（插件调用方在 PluginView 内 useDlientApi() 取得后传入）。
   * 传入后 header/body/footer 自动包进 PluginApiContext.Provider（+ I18nProvider），
   * 弹窗内 useDlientApi()/useI18n() 直接可用；宿主自身不传时行为不变。
   */
  api?: PluginApi
  onClose?: () => void
  onOpened?: () => void
  onClosed?: () => void
}

export interface DialogInstance {
  update: (opts: Partial<DialogOptions>) => void
  destroy: () => void
  close: () => void
  setConfirmLoading?: (loading: boolean) => void
  hide: () => void
}

function normalizeWidth(width: string | number): string {
  return typeof width === 'number' ? `${width}px` : width
}

export function DialogPlugin(opts: DialogOptions): DialogInstance {
  ensureUiStyles()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)

  let current: DialogOptions = { ...opts }
  let destroyed = false
  let closed = false

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    try {
      current.onClosed?.()
    } finally {
      setTimeout(() => root.unmount(), 0)
      host.remove()
    }
  }

  const close = () => {
    if (closed) return
    closed = true
    const cb = current.onClose
    destroy()
    cb?.()
  }

  const render = () => {
    const {
      header,
      body,
      children,
      footer,
      closeBtn = true,
      width = 420,
      height,
      top,
      placement = 'center',
      showOverlay = true,
      closeOnOverlayClick = false,
      zIndex,
      className,
      dialogClassName,
      style,
      api,
    } = current

    // 方案 B 作用域：传了 api（插件场景）时，header/body/footer 为插件自定义内容，
    // 各自带 data-plugin 并包进 PluginApiContext + I18nProvider（弹框内 useDlientApi 可用）；
    // 遮罩 / 卡片 / 关闭按钮（chrome）保持全局。宿主自身不传 api → 原样渲染，行为不变。
    const scopeId = api?.pluginId ? pluginScopeId(api.pluginId) : undefined
    const wrap = (node: React.ReactNode): React.ReactNode =>
      api ? (
        <I18nProvider>
          <PluginApiContext.Provider value={api}>{node}</PluginApiContext.Provider>
        </I18nProvider>
      ) : (
        node
      )

    const cardStyle: React.CSSProperties = {
      width: normalizeWidth(width),
      ...(height != null ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
      ...style,
    }
    if (placement === 'top' && top != null) cardStyle.marginTop = typeof top === 'number' ? `${top}px` : top
    if (placement === 'top' && top === 0) {
      cardStyle.borderRadius = "2px 2px 6px 6px"
    } else {
      cardStyle.borderRadius = "6px 6px 6px 6px"
    }

    root.render(
      <>
        {showOverlay ? (
          <div
            className="dui-dialog-mask"
            style={{ zIndex }}
            onClick={closeOnOverlayClick ? close : undefined}
          />
        ) : null}
        <div className="dui-dialog-wrap" style={{ zIndex }}>
          <div
            role="dialog"
            aria-modal="true"
            className={cn('dui-dialog', placement === 'center' ? 'dui-dialog--center' : 'dui-dialog--top', className, dialogClassName)}
            style={cardStyle}
          >
            {header != null ? (
              <div className="dui-dialog__header">
                <div style={{ flex: 1, minWidth: 0 }} data-plugin={scopeId}>
                  {wrap(header)}
                </div>
                {closeBtn !== false ? (
                  <button type="button" aria-label="close" className="dui-dialog__close" onClick={close}>
                    {closeBtn === true ? <X size={18} /> : closeBtn}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="dui-dialog__body" data-plugin={scopeId}>
              {wrap(body ?? children)}
            </div>
            {footer != null ? (
              <div className="dui-dialog__footer" data-plugin={scopeId}>
                {wrap(footer)}
              </div>
            ) : null}
          </div>
        </div>
      </>,
    )
  }

  render()
  setTimeout(() => current.onOpened?.(), 0)

  const instance: DialogInstance = {
    update: (patch: Partial<DialogOptions>) => {
      current = { ...current, ...patch }
      render()
    },
    destroy,
    close,
    setConfirmLoading: () => {
      /* 命令式 DialogPlugin 未实现加载态：兼容占位（不渲染 spinner） */
    },
    hide: destroy,
  }
  if (opts.closeOnEscKeydown) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    const orig = destroy
    instance.destroy = () => {
      window.removeEventListener('keydown', onKey)
      orig()
    }
  }
  return instance
}

export default DialogPlugin
