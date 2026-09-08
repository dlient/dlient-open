/**
 * plugin-api.augment.ts - 为 @dlient-open/api-bridge 的 PluginApi 增补 `modal` 命令式弹框成员。
 *
 * 命令式弹框（modal.confirm / modal.dialog 等）运行在渲染层、属于 @dlient-open/ui 自身能力，
 * 不是 host-api，因此类型不放 api-bridge（避免 ui ↔ api-bridge 循环依赖）：
 * 这里用 TS 模块增补把 modal 挂到 PluginApi 类型上；
 * 运行时由 PluginView 装配 api 时注入（自动绑定本视图 api，插件无需手动传 options.api）。
 */
import type { ReactNode } from 'react'
import type { DialogOptions, DuiDialogInstance } from './dialog'
import type { ModalOptions, DuiModalInstance } from './index'

declare module '@dlient-open/api-bridge' {
  interface PluginApi {
    /**
     * 命令式弹框（自动注入本视图 api）：弹框内容自动包进 PluginApiContext + 插件 CSS 作用域，
     * 插件直接调用 api.modal.confirm(...) / api.modal.dialog(...) 即可，无需手动传 options.api。
     */
    modal: {
      /** 信息提示弹框 */
      info: (options?: ModalOptions) => DuiModalInstance
      /** 成功提示弹框 */
      success: (options?: ModalOptions) => DuiModalInstance
      /** 警告弹框 */
      warn: (options?: ModalOptions) => DuiModalInstance
      /** 错误弹框 */
      error: (options?: ModalOptions) => DuiModalInstance
      /** 删除确认弹框（红色垃圾桶 + 危险按钮 + 取消） */
      delete: (options?: ModalOptions) => DuiModalInstance
      /** 确认弹框 */
      confirm: (options?: ModalOptions) => DuiModalInstance
      /** 吸顶通用弹框（header/body/footer 全自定义，内容区零 padding） */
      dialog: (options?: DialogOptions) => DuiDialogInstance
      /** 同步结果版：const ok = await api.modal.sync.confirm('标题', '描述') */
      sync: {
        info: (title?: ReactNode, description?: ReactNode) => Promise<boolean>
        success: (title?: ReactNode, description?: ReactNode) => Promise<boolean>
        warn: (title?: ReactNode, description?: ReactNode) => Promise<boolean>
        error: (title?: ReactNode, description?: ReactNode) => Promise<boolean>
        delete: (title?: ReactNode, description?: ReactNode) => Promise<boolean>
        confirm: (title?: ReactNode, description?: ReactNode) => Promise<boolean>
      }
    }
  }
}

export {}
