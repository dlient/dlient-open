import type { ReactNode } from 'react'
import { InfoIcon, SuccessIcon, WarningIcon, ErrorIcon, TrashIcon } from './icons'

/** 语义变体 */
export type ModalVariant = 'info' | 'success' | 'warn' | 'error' | 'delete' | 'confirm'

export interface VariantPreset {
  /** 预设图标 */
  icon: ReactNode
  /** 确认按钮的语义主题（走 tokens 变量，底色 / hover / loading 全部引用 --dlient-*） */
  btnTheme: 'primary' | 'success' | 'warning' | 'danger'
  /**
   * 默认确认按钮文案的 i18n key（'namespace.path'）。
   * 不在此处写死具体语言，由 index.tsx 在弹框打开时经 @dlient-open/i18n store 解析，
   * ModalFooter 内再经 useUiText 实时订阅语言切换。
   */
  confirmTextKey: string
  /** 有值 → 默认渲染取消按钮（双按钮形态） */
  cancelTextKey?: string
}

/** 图标尺寸：24 viewBox 用 36px，1024 viewBox 图形满幅需收一档到 32px */
const SIZE_24 = { width: 36, height: 36 }
const SIZE_1024 = { width: 32, height: 32 }

export const PRESETS: Record<ModalVariant, VariantPreset> = {
  info: {
    icon: <InfoIcon {...SIZE_24} className="dui-modal-anim-float" />,
    btnTheme: 'primary',
    confirmTextKey: 'ui.modalConfirm',
  },
  success: {
    icon: <SuccessIcon {...SIZE_24} className="dui-modal-anim-beat" />,
    btnTheme: 'success',
    confirmTextKey: 'ui.modalConfirm',
  },
  warn: {
    icon: <WarningIcon {...SIZE_24} className="dui-modal-anim-shake" />,
    btnTheme: 'warning',
    confirmTextKey: 'ui.modalConfirm',
  },
  error: {
    icon: <ErrorIcon {...SIZE_24} className="dui-modal-anim-throb" />,
    btnTheme: 'danger',
    confirmTextKey: 'ui.modalConfirm',
  },
  /** 删除确认：错误色 + 垃圾桶 + 双按钮 */
  delete: {
    icon: <TrashIcon {...SIZE_1024} />,
    btnTheme: 'danger',
    confirmTextKey: 'ui.modalConfirm',
    cancelTextKey: 'ui.modalCancel',
  },
  /** 操作确认：警告色 + 三角 + 双按钮 */
  confirm: {
    icon: <WarningIcon {...SIZE_24} className="dui-modal-anim-shake" />,
    btnTheme: 'warning',
    confirmTextKey: 'ui.modalConfirm',
    cancelTextKey: 'ui.modalCancel',
  },
}
