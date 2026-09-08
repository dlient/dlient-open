import './i18n'

// ============ 工具 ============
export { cn } from './lib/utils'
export { ensureUiStyles } from './components/ui/styles'
export { useIsMobile } from './hooks/use-mobile'

// ============ shadcn/ui radix-mira 原语（Tailwind v4 编译，dui 前缀，样式自包含）============
// 全部工具类以 dui: 开头（如 dui:flex、dui:hover:bg-primary），由 @dlient-open/ui 注入全局单实例样式。
export * from './components/ui/button'
export * from './components/ui/input'
export * from './components/ui/textarea'
export * from './components/ui/checkbox'
export * from './components/ui/label'
export * from './components/ui/badge'
export * from './components/ui/separator'
export * from './components/ui/skeleton'
export * from './components/ui/card'
export * from './components/ui/aspect-ratio'
export * from './components/ui/toggle'
export * from './components/ui/toggle-group'
export * from './components/ui/progress'
export * from './components/ui/slider'
export * from './components/ui/scroll-area'
export * from './components/ui/avatar'
export * from './components/ui/alert'
export * from './components/ui/collapsible'
export * from './components/ui/breadcrumb'
export * from './components/ui/pagination'
export * from './components/ui/accordion'
export * from './components/ui/alert-dialog'
export * from './components/ui/dialog'
export * from './components/ui/sheet'
export * from './components/ui/drawer'
export * from './components/ui/dropdown-menu'
export * from './components/ui/popover'
export * from './components/ui/select'
export * from './components/ui/switch'
export * from './components/ui/tabs'
export * from './components/ui/table'
export * from './components/ui/tooltip'
export * from './components/ui/hover-card'
export * from './components/ui/context-menu'
export * from './components/ui/menubar'
export * from './components/ui/navigation-menu'
export * from './components/ui/input-otp'

// ============ radix-mira 新增原语 ============
export * from './components/ui/attachment'
export * from './components/ui/bubble'
export * from './components/ui/button-group'
export * from './components/ui/calendar'
export * from './components/ui/carousel'
export * from './components/ui/chart'
export * from './components/ui/chat-message'
export * from './components/ui/combobox'
export * from './components/ui/command'
export * from './components/ui/direction'
export * from './components/ui/empty'
export * from './components/ui/field'
export * from './components/ui/input-group'
export * from './components/ui/item'
export * from './components/ui/kbd'
export * from './components/ui/marker'
export * from './components/ui/native-select'
export * from './components/ui/radio-group'
export * from './components/ui/resizable'
export * from './components/ui/sidebar'
export * from './components/ui/spinner'

// ============ 命令式反馈（API 兼容保留，样式走包内 shadcn 变量）============
export { DialogPlugin, type DialogOptions, type DialogInstance } from './components/ui/dialog-plugin'
export { MessagePlugin, message, type MessageType, type MessageInstance } from './components/ui/message'

// ============ Sonner Toast（无 next-themes 依赖，theme 由 props 透传）============
export { Toaster, toast } from './components/ui/sonner'

// ============ 展示辅助（无 shadcn 对应物，API 保留，样式自包含）============
// 注：Empty / Spinner 已由 radix-mira 原语接管（见上 export *），此处仅保留其余 legacy 组件。
export { Tag, Space, Divider, Loading, Steps, Popup, type TagProps, type TagTheme, type SpaceProps, type DividerProps, type LoadingProps, type StepsProps, type TooltipProps as LegacyTooltipProps } from './components/ui/display'

// ============ 图标（lucide 实现；Icon name 与 tdesign 风格具名图标均兼容）============
export { Icon, type IconProps, SearchIcon, UploadIcon, CodeIcon, RefreshIcon, CloseIcon, LoadingIcon, TimeIcon, CheckCircleFilledIcon, CloseCircleFilledIcon, DeleteIcon, DownloadIcon, AddIcon, FolderOpenIcon, AppIcon } from './components/icon'

// ============ dlient 专属 ============
export { PluginView, type PluginViewProps } from './components/plugin-view'
export { PluginIcon, type PluginIconProps } from './components/plugin-icon'
export { PluginErrorBoundary, type PluginErrorBoundaryProps } from './components/plugin-error-boundary'
export { Webview, type WebviewProps, type WebviewHandle } from './components/webview'
export { LogViewer, type LogViewerProps } from './components/log-viewer'
// 函数式反馈弹框 + 吸顶通用弹框
export { modal, createDialog, type DialogOptions as DuiDialogOptions, type DialogContext, type DuiDialogInstance, type DuiModalInstance, type ModalConfirmTheme } from './components/modal'
export type { ModalOptions, ModalContext, ModalButton, ModalVariant, VariantPreset } from './components/modal'
export { useDlientApi, PluginApiContext, isApiOk, resolveApiMsg, defaultApiErrorMsg, ApiError, apiData, unwrapApi, apiOr, toApiError } from '@dlient-open/api-bridge'
export type { PluginApi, ApiResponse, ResponseErrorMsg, DlientErrorCode } from '@dlient-open/api-bridge'

// ============ 渲染层状态共享 / 事件传递（docs/specs/store-event.md）============
export {
  useDientStore,
  useStoreValue,
  setHostGlobal,
  type DientStore,
  type DientStoreScope,
  type DientStoreGlobalScope,
  type StoreIdentity,
  type StoreWatchCallback,
} from './store'
export {
  useDientEvent,
  emitHostEvent,
  type DientEvent,
  type DientEventScope,
  type DientEventGlobalScope,
  type DientEventCallback,
  type EventMeta,
} from './event'
