/**
 * 命令式 Modal API 模块：对外只导出 `modal` 对象与类型，不导出任何 React 组件。
 * 文内的 ModalFooter / ModalBodySub / ModalFooterSub 是喂给 DialogPlugin 的私有渲染单元，
 * 随弹窗实例创建销毁，本就不在组件树的稳定位置上 —— fast refresh 对本文件结构上不适用。
 */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from 'react'
import { DialogPlugin } from '../ui/dialog-plugin'
import type { DialogInstance } from '../ui/dialog-plugin'
import { Button } from '../ui/button'
import { LoadingIcon } from '../icon'
import type { PluginApi } from '@dlient-open/api-bridge'
import { pluginScopeId } from '../../lib/plugin-portal'
import { PRESETS, type ModalVariant, type VariantPreset } from './presets'
import { createDialog, withContext } from './dialog'
import { ensureModalStyles } from './styles'
import { uiText, useUiText } from './i18n'
import './plugin-api.augment'

/** 按钮配置：字符串自定义文案 / ReactNode 完全自定义 / null 不显示 */
export type ModalButton = string | ReactNode | null

export interface ModalOptions {
  /** 图标。不传用变体预设；传 null 不显示图标 */
  icon?: ReactNode | null
  /** 标题。不传则不渲染标题节点 */
  title?: ReactNode
  /** 描述内容 */
  description?: ReactNode
  /** 确认按钮 */
  confirmBtn?: ModalButton
  /** 取消按钮 */
  cancelBtn?: ModalButton
  /** 右上角关闭按钮：true 显示 / false 隐藏 / ReactNode 自定义 */
  closeBtn?: boolean | ReactNode
  /** 底部区域。传入则完全替代按钮区（confirmBtn / cancelBtn 失效） */
  footer?: ReactNode
  /**
   * 点击确认。返回 false 阻止关闭；
   * 返回 Promise 时自动挂确认按钮 loading，resolve false 同样阻止关闭
   */
  onConfirm?: (ctx: ModalContext) => void | boolean | Promise<void | boolean>
  /** 点击取消。返回 false 阻止关闭 */
  onCancel?: (ctx: ModalContext) => void | boolean | Promise<void | boolean>
  /** 关闭后回调（含取消 / 关闭按钮 / 遮罩 / ESC） */
  onClose?: () => void
  /** 弹框宽度，默认 420（仅创建时生效） */
  width?: string | number
  /** 点击遮罩是否关闭，默认 false */
  closeOnOverlayClick?: boolean
  /** 按 ESC 是否关闭，默认 false */
  closeOnEscKeydown?: boolean
  /** 追加类名 */
  className?: string
  /** 层级 */
  zIndex?: number
  /** 插件实例 API：传入后正文自动包进 PluginApiContext（+ I18nProvider），弹窗内 useDlientApi/useI18n 可用 */
  api?: PluginApi
}

export interface ModalContext {
  /** DialogPlugin 弹框实例，可手动 hide / destroy / setConfirmLoading */
  instance: DialogInstance
  /** 关闭并销毁 */
  close: () => void
}

/**
 * 反馈弹框实例：在 DialogInstance 基础上扩展 update（DialogPlugin 原生 update 只覆盖
 * 静态渲染 props，这里改为更新我们自己的按钮 / 回调模型）。
 * 弹框本身不重建，按钮 loading 状态保持。
 */
export interface DuiModalInstance extends Omit<DialogInstance, 'update'> {
  /** 修改参数并更新弹框内容 */
  update: (patch: Partial<ModalOptions>) => void
  /** 关闭并销毁，与 onClose 同源（幂等） */
  close: () => void
}

/** 内部：变体 + 用户配置 */
interface InternalOptions extends ModalOptions {
  variant: ModalVariant
}

/* ------------------------------------------------------------------ */

/**
 * 归一化按钮：
 * - string → 调用方自定义文案（原样显示，不做翻译）
 * - undefined + fallbackKey → 预设默认文案的 i18n key（ModalFooter 内经 useUiText 实时解析）
 * - ReactNode → 完全自定义节点
 * - null → 不显示
 */
type ResolvedBtn = { text: string } | { textKey: string } | { node: ReactNode } | null

function resolveBtn(input: ModalButton | undefined, fallbackKey?: string): ResolvedBtn {
  if (input === null) return null
  if (input === undefined) return fallbackKey ? { textKey: fallbackKey } : null
  if (typeof input === 'string') return { text: input }
  return { node: input }
}

/**
 * 构建弹框正文：关闭按钮 + 图标 + 标题 + 描述
 *
 * DialogPlugin 仅在 header 非空时渲染头部；本弹框不使用 header，
 * 因此关闭按钮必须在这里自绘（.dui-modal__close），不依赖 DialogPlugin 的 closeBtn。
 * scopeId（插件 CSS 作用域锚点）加到正文容器：方案 B——只作用域化插件自定义内容区，
 * 遮罩 / 卡片 / 按钮区（chrome）保持全局不受插件 CSS 影响。
 */
function buildBody(opts: InternalOptions, icon: ReactNode | null, onClose: () => void, scopeId?: string): ReactNode {
  const closeBtn = opts.closeBtn ?? true

  return (
    <div className="dui-modal__body" data-plugin={scopeId}>
      {closeBtn !== false && (
        <button type="button" className="dui-modal__close" aria-label={uiText('ui.modalClose')} onClick={onClose}>
          {closeBtn === true ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            closeBtn
          )}
        </button>
      )}

      {icon !== null && (
        <div className="dui-modal__icon-wrap">
          <span className="dui-modal__ring dui-modal-anim-ring" aria-hidden="true" />
          <span className="dui-modal__ring dui-modal-anim-ring-2" aria-hidden="true" />
          <span className="dui-modal__icon dui-modal-anim-pop">{icon}</span>
        </div>
      )}

      {opts.title !== undefined && opts.title !== null && (
        <h2 className="dui-modal__title">{opts.title}</h2>
      )}

      {/* 用 div 而非 p：描述允许传入 div / 进度条等块级节点，p 会触发 validateDOMNesting 警告 */}
      {opts.description !== undefined && opts.description !== null && (
        <div className="dui-modal__desc">{opts.description}</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** 确认按钮配色（new-york Button 的扩展：danger→destructive，success/warning 走语义色覆盖类） */
export type ModalConfirmTheme = 'primary' | 'danger' | 'success' | 'warning'

interface FooterProps {
  cancel: ResolvedBtn
  confirm: ResolvedBtn
  dual: boolean
  /** 确认按钮配色 */
  confirmTheme: ModalConfirmTheme
  onCancel: () => void | Promise<void>
  onConfirm: () => void | Promise<void>
}

/** 把配色映射到 shadcn variant + 语义色覆盖类（success/warning 非 shadcn variant，叠加类覆盖） */
function themeToButton(theme: ModalConfirmTheme): { variant: 'default' | 'error' | 'success' | 'warning' ; override?: string } {
  switch (theme) {
    case 'danger':
      return { variant: 'error' }
    case 'success':
      return { variant: 'success' }
    case 'warning':
      return { variant: 'warning' }
    default:
      return { variant: 'default' }
  }
}

/**
 * 按钮区。自定义 footer 场景下 DialogPlugin 的 setConfirmLoading 不作用于这里的按钮，
 * 因此 loading 由组件自身持有。
 * 预设默认文案存的是 i18n key，经 useUiText 实时订阅语言，切换即跟随。
 */
function ModalFooter({ cancel, confirm, dual, confirmTheme, onCancel, onConfirm }: FooterProps) {
  const [loading, setLoading] = useState(false)
  const t = useUiText()

  const runConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  /** 渲染按钮：自定义节点原样；文本类按 text / textKey 区分解析 */
  const renderBtn = (
    btn: ResolvedBtn,
    cls: string,
    onClick: () => void | Promise<void>,
    extra?: { theme?: ModalConfirmTheme; kind?: 'primary' | 'cancel'; loading?: boolean; disabled?: boolean },
  ) => {
    if (!btn) return null
    if ('node' in btn) return btn.node
    const text = 'text' in btn ? btn.text : t(btn.textKey)
    const mapped =
      extra?.kind === 'cancel' ? { variant: 'secondary' as const } : themeToButton(extra?.theme ?? 'primary')
    const finalCls = [cls, mapped.variant === 'default' ? mapped.override : undefined].filter(Boolean).join(' ')
    const busy = extra?.loading
    return (
      <Button
        variant={mapped.variant}
        className={finalCls}
        disabled={extra?.disabled || busy}
        onClick={() => onClick()}
      >
        {busy ? <LoadingIcon aria-hidden="true" /> : null}
        {text}
      </Button>
    )
  }

  return (
    <div className={`dui-modal__footer${dual ? ' dui-modal__footer--dual' : ''}`}>
      {cancel && renderBtn(cancel, 'dui-modal__btn dui-modal__btn--cancel', onCancel, { kind: 'cancel', disabled: loading })}
      {confirm && renderBtn(confirm, 'dui-modal__btn dui-modal__btn--confirm', runConfirm, { theme: confirmTheme, loading })}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** 订阅可变弹框状态：update() 触发后重渲染对应区域 */
function useModalState(getState: () => InternalOptions, subscribe: (fn: () => void) => () => void): InternalOptions {
  const [state, setState] = useState(getState)
  useEffect(() => subscribe(() => setState(getState())), [getState, subscribe])
  return state
}

/** 正文订阅容器（负责标题 / 描述 / 图标 / 关闭按钮的更新） */
function ModalBodySub({
  getState,
  subscribe,
  preset,
  onClose,
  scopeId,
}: {
  getState: () => InternalOptions
  subscribe: (fn: () => void) => () => void
  preset: VariantPreset
  onClose: () => void
  scopeId?: string
}) {
  const state = useModalState(getState, subscribe)
  const icon = state.icon === undefined ? preset.icon : state.icon
  return buildBody(state, icon, onClose, scopeId)
}

/** 按钮区订阅容器（负责 confirmBtn / cancelBtn / footer 的更新） */
function ModalFooterSub({
  getState,
  subscribe,
  preset,
  onCancel,
  onConfirm,
  scopeId,
}: {
  getState: () => InternalOptions
  subscribe: (fn: () => void) => () => void
  preset: VariantPreset
  onCancel: () => void | Promise<void>
  onConfirm: () => void | Promise<void>
  scopeId?: string
}) {
  const state = useModalState(getState, subscribe)
  const confirm = resolveBtn(state.confirmBtn, preset.confirmTextKey)
  const cancel = resolveBtn(state.cancelBtn, preset.cancelTextKey)
  const dual = Boolean(confirm && cancel)

  if (state.footer) {
    // 自定义 footer 属插件内容：加作用域锚点；默认按钮区（chrome）不加
    return (
      <div className="dui-modal__footer dui-modal__footer--custom" data-plugin={scopeId}>
        {state.footer}
      </div>
    )
  }
  // 无按钮：返回 null 让 DialogPlugin 的 footer 容器保持 0 高度（.dui-modal .dui-dialog__footer padding 已清零）
  if (!confirm && !cancel) return null
  return (
    <ModalFooter
      cancel={cancel}
      confirm={confirm}
      dual={dual}
      confirmTheme={preset.btnTheme}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

/* ------------------------------------------------------------------ */

/** 核心：创建反馈弹框（支持 update 更新参数） */
function createModal(opts: InternalOptions): DuiModalInstance {
  ensureModalStyles()
  const preset = PRESETS[opts.variant]
  // 方案 B 作用域：仅插件自定义内容区带 data-plugin（经 api 推导 scopeId，剥 '@dev' 与构建期对齐）
  const scopeId = opts.api?.pluginId ? pluginScopeId(opts.api.pluginId) : undefined

  // 可变状态 + 订阅：update() 只替换参数并通知渲染层，弹框不重建
  let state: InternalOptions = { ...opts }
  const listeners = new Set<() => void>()
  const getState = (): InternalOptions => state
  const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }
  const setState = (patch: Partial<ModalOptions>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  // 保证 onClose 只触发一次（取消 / 关闭按钮 / 遮罩 / ESC 可能叠加）
  let closed = false

  /** 关闭并触发 onClose（DialogPlugin 的 destroy 本身不触发 onClose） */
  const closeAndNotify = () => {
    if (closed) return
    closed = true
    instance.destroy()
    getState().onClose?.()
  }

  const ctx = (): ModalContext => ({
    instance,
    close: closeAndNotify,
  })

  /** 包装回调：返回 false 阻止关闭 */
  async function handle(fn: ModalOptions['onConfirm']): Promise<void> {
    if (!fn) {
      closeAndNotify()
      return
    }
    const ret = await fn(ctx())
    if (ret === false) return // 阻止关闭
    closeAndNotify()
  }

  /** 关闭按钮点击：等价于取消（走 onCancel，再触发 onClose） */
  const handleCloseBtn = () => {
    void handle(getState().onCancel)
  }

  // 上述回调闭包中引用 instance：均为交互触发，DialogPlugin 同步返回后才可能执行
  const instance: DialogInstance = DialogPlugin({
    header: null,
    body: withContext(
      <ModalBodySub getState={getState} subscribe={subscribe} preset={preset} onClose={handleCloseBtn} scopeId={scopeId} />,
      opts.api,
    ),
    footer: withContext(
      <ModalFooterSub
        getState={getState}
        subscribe={subscribe}
        preset={preset}
        onCancel={() => handle(getState().onCancel)}
        onConfirm={() => handle(getState().onConfirm)}
        scopeId={scopeId}
      />,
      opts.api,
    ),
    // header 未渲染 → 关闭按钮由正文自绘（dui-modal__close），此处显式关掉避免歧义
    closeBtn: false,
    width: opts.width ?? 420,
    placement: 'center',
    // 反馈弹框要求明确决策，默认不允许遮罩 / ESC 关闭，可按需开启
    closeOnOverlayClick: opts.closeOnOverlayClick ?? false,
    closeOnEscKeydown: opts.closeOnEscKeydown ?? false,
    destroyOnClose: true,
    zIndex: opts.zIndex,
    className: `dui-modal dui-modal--${opts.variant}${opts.className ? ` ${opts.className}` : ''}`,
    onClose: closeAndNotify,
  })

  const result = instance as DuiModalInstance
  result.update = (patch: Partial<ModalOptions>) => setState(patch)
  result.close = closeAndNotify
  return result
}

/* ------------------------------------------------------------------ */

function make(variant: ModalVariant) {
  return (options: ModalOptions = {}): DuiModalInstance => createModal({ ...options, variant })
}

/** 同步（await）形式：只关心结果，确认 → true，取消 / 关闭 → false */
function makeSync(variant: ModalVariant) {
  return (title?: ReactNode, description?: ReactNode): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let settled = false
      const done = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }

      createModal({
        variant,
        title,
        description,
        onConfirm: () => { done(true) },
        onCancel: () => { done(false) },
        onClose: () => { done(false) },
      })
    })
}

export const modal = {
  info: make('info'),
  success: make('success'),
  warn: make('warn'),
  error: make('error'),
  delete: make('delete'),
  confirm: make('confirm'),

  /** 吸顶通用弹框：内容区零 padding，header / body / footer 全自定义 */
  dialog: createDialog,

  /** 同步结果版：const ok = await modal.sync.confirm('标题', '描述') */
  sync: {
    info: makeSync('info'),
    success: makeSync('success'),
    warn: makeSync('warn'),
    error: makeSync('error'),
    delete: makeSync('delete'),
    confirm: makeSync('confirm'),
  },
}

export default modal

export type { DialogOptions, DialogContext, DuiDialogInstance } from './dialog'
export { createDialog } from './dialog'
export type { ModalVariant, VariantPreset } from './presets'
