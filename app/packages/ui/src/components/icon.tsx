import React from 'react'
import * as Lucide from 'lucide-react'
import {
  Search, Upload, Code, RefreshCw, X, CheckCircle, HelpCircle, Loader2, Clock,
  CheckCircle2, XCircle, Trash2, Download, Plus, FolderOpen, AppWindow, AlertCircle,
  Check, Info, AlertTriangle, Trash, Settings, Send, File, MessageSquare,
  CircleStop, Copy, ChevronRight, ChevronDown, ChevronLeft, MoreHorizontal,
  ArrowRight, Eye, EyeOff, KeyRound, Lock, Shield, Globe, Box, LayoutGrid,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'

/**
 * Icon - 兼容层（lucide 版）：`<Icon name="search" />` 旧写法适配。
 * tdesign-icons-react 已弃用，改用 lucide-react；kebab-case name → lucide 组件。
 * 未命中 NAME_MAP 时回落全量 lucide 图标（见 toPascal），仍找不到才渲染 null 并告警。
 */
export interface IconProps extends Omit<LucideProps, 'name'> {
  name: string
}

const NAME_MAP: Record<string, React.ComponentType<LucideProps>> = {
  search: Search,
  upload: Upload,
  code: Code,
  refresh: RefreshCw,
  close: X,
  check: Check,
  'check-circle': CheckCircle,
  'check-circle-filled': CheckCircle2,
  'close-circle-filled': XCircle,
  'close-circle': XCircle,
  'help-circle': HelpCircle,
  loading: Loader2,
  time: Clock,
  delete: Trash,
  'delete-1': Trash2,
  download: Download,
  add: Plus,
  'folder-open': FolderOpen,
  app: AppWindow,
  'app-icon': AppWindow,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
  setting: Settings,
  send: Send,
  file: File,
  chat: MessageSquare,
  'stop-circle': CircleStop,
  copy: Copy,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'more-horizontal': MoreHorizontal,
  'arrow-right': ArrowRight,
  eye: Eye,
  'eye-off': EyeOff,
  'key-round': KeyRound,
  lock: Lock,
  shield: Shield,
  globe: Globe,
  box: Box,
  layout: LayoutGrid,
}

const LUCIDE = Lucide as unknown as Record<string, React.ComponentType<LucideProps>>

/** name → lucide 组件名：'chevron-right' / 'chevron_right' → 'ChevronRight'（已是 Pascal 则原样） */
function toPascal(name: string): string {
  return name
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function Icon({ name, ...rest }: IconProps) {
  // NAME_MAP 只是历史别名 / tdesign 风格映射；未收录的名字直接回落全量 lucide 图标
  // （'trash-2' / 'Trash2' / 'trash2' 均可用），无需再逐个登记。
  const pascal = toPascal(name)
  const Component = NAME_MAP[name] ?? LUCIDE[pascal] ?? LUCIDE[`${pascal}Icon`]
  if (!Component) {
    console.warn(`[dlient/ui] unknown icon name: "${name}"`)
    return null
  }
  return <Component {...rest} />
}

/** 具名图标兼容导出（原 tdesign 风格，供插件无感迁移） */
export { Search as SearchIcon, Upload as UploadIcon, Code as CodeIcon, RefreshCw as RefreshIcon, X as CloseIcon, Loader2 as LoadingIcon, Clock as TimeIcon }
export { CheckCircle2 as CheckCircleFilledIcon, XCircle as CloseCircleFilledIcon, Trash2 as DeleteIcon, Download as DownloadIcon, Plus as AddIcon, FolderOpen as FolderOpenIcon, AppWindow as AppIcon }

export default Icon
