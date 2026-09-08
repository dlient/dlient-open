import React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Badge, type BadgeVariant } from './badge'

/* ================= Tag（基于 Badge 实现，视觉统一 nova Badge） ================= */
export type TagTheme = 'default' | 'primary' | 'success' | 'warning' | 'danger'
export interface TagProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** tdesign 语义色（映射到 Badge variant） */
  theme?: TagTheme
  /** 兼容旧形态：dark/light 在统一 nova 视觉后不再区分（等同实心主题色），仅 outline 生效 */
  variant?: 'dark' | 'light' | 'outline'
  size?: 'small' | 'medium' | 'large'
  icon?: React.ReactNode
  closable?: boolean
  onClose?: (e: React.MouseEvent) => void
}

/** tag.theme → Badge variant：primary→default 实心主色；default→secondary 中性灰；danger 沿用 nova destructive 语义 */
const TAG_THEME_TO_BADGE: Record<TagTheme, BadgeVariant> = {
  default: 'secondary',
  primary: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
}

/** size 兼容：small 即 Badge 默认小尺寸（不加类）；medium/large 覆写高度/字号 */
const TAG_SIZE_CLS: Record<NonNullable<TagProps['size']>, string> = {
  small: '',
  medium: 'dui:h-6 dui:px-2.5 dui:text-xs',
  large: 'dui:h-7 dui:px-3 dui:text-sm',
}

export function Tag({ theme = 'default', variant, size = 'small', icon, closable, onClose, className, children, ...rest }: TagProps) {
  const badgeVariant: BadgeVariant = variant === 'outline' ? 'outline' : TAG_THEME_TO_BADGE[theme]
  return (
    <Badge
      {...rest}
      variant={badgeVariant}
      className={cn('dui:max-w-full', TAG_SIZE_CLS[size], className)}
    >
      {icon}
      <span className="dui:min-w-0 dui:truncate">{children}</span>
      {closable ? (
        <button
          type="button"
          aria-label="close"
          className="dui:inline-flex dui:cursor-pointer dui:border-none dui:bg-transparent dui:p-0 dui:text-current dui:opacity-70 dui:hover:opacity-100"
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </Badge>
  )
}

/* ================= Space ================= */
export interface SpaceProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number | 'small' | 'medium' | 'large'
  direction?: 'horizontal' | 'vertical'
  breakLine?: boolean
}

const SPACE_PX = { small: 8, medium: 16, large: 24 }

export function Space({ size = 'small', direction = 'horizontal', breakLine, style, children, className, ...rest }: SpaceProps) {
  const gap = typeof size === 'number' ? size : SPACE_PX[size] ?? 8
  return (
    <div
      {...rest}
      className={cn('dui:inline-flex', direction === 'horizontal' ? 'dui:items-center' : 'dui:flex-col dui:items-start', breakLine && 'dui:flex-wrap', className)}
      style={{ gap, ...style }}
    >
      {children}
    </div>
  )
}

/* ================= Divider ================= */
export interface DividerProps {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  dashed?: boolean
}
export function Divider({ children, className, style, dashed }: DividerProps) {
  if (children != null) {
    return (
      <div className={cn('dui:flex dui:w-full dui:items-center dui:gap-2 dui:text-xs dui:text-muted-foreground', className)} style={style}>
        <div className={cn('dui:h-px dui:flex-1 dui:bg-border', dashed && 'bg-[repeating-linear-gradient(90deg,var(--border)_0_4px,transparent_4px_8px)]')} />
        <span className="dui:whitespace-nowrap">{children}</span>
        <div className={cn('dui:h-px dui:flex-1 dui:bg-border', dashed && 'bg-[repeating-linear-gradient(90deg,var(--border)_0_4px,transparent_4px_8px)]')} />
      </div>
    )
  }
  return <div className={cn('dui:h-px dui:w-full dui:bg-border', dashed && 'bg-[repeating-linear-gradient(90deg,var(--border)_0_4px,transparent_4px_8px)]', className)} style={style} />
}

/* ================= Empty ================= */
export interface EmptyProps {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}
export function Empty({ title, description, icon, action, className, style }: EmptyProps) {
  return (
    <div className={cn('dui:flex dui:flex-col dui:items-center dui:justify-center dui:gap-2 dui:py-10 dui:text-center dui:text-muted-foreground', className)} style={style}>
      {icon != null ? <div className="dui:mb-1 dui:opacity-60">{icon}</div> : null}
      {title != null ? <div className="dui:text-sm dui:font-medium dui:text-foreground">{title}</div> : null}
      {description != null ? <div className="dui:max-w-xs dui:text-sm">{description}</div> : null}
      {action != null ? <div className="dui:mt-2">{action}</div> : null}
    </div>
  )
}

/* ================= Loading / Spinner ================= */
export interface SpinnerProps {
  size?: 'small' | 'medium' | 'large'
  className?: string
}
export function Spinner({ size = 'medium', className }: SpinnerProps) {
  const px = size === 'small' ? 'dui:h-4 dui:w-4' : size === 'large' ? 'dui:h-8 dui:w-8' : 'dui:h-6 dui:w-6'
  return <Loader2 className={cn('dui:animate-spin dui:text-primary', px, className)} />
}

export interface LoadingProps extends React.HTMLAttributes<HTMLDivElement> {
  loading?: boolean
  text?: React.ReactNode
  size?: 'small' | 'medium' | 'large'
  fullscreen?: boolean
  children?: React.ReactNode
}
export function Loading({ loading = true, text, size, children, className, style }: LoadingProps) {
  if (!loading) return <>{children}</>
  return (
    <div className={cn('dui:flex dui:flex-col dui:items-center dui:justify-center dui:gap-2 dui:py-6 dui:text-sm dui:text-muted-foreground', className)} style={style}>
      <Spinner size={size} />
      {text != null && text !== '' ? <span>{text}</span> : null}
    </div>
  )
}

/* ================= Progress ================= */
export interface ProgressProps {
  percentage?: number
  label?: boolean
  status?: 'normal' | 'success' | 'danger' | 'warning'
  className?: string
  style?: React.CSSProperties
}
export function Progress({ percentage = 0, label = true, status = 'normal', className, style }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, percentage))
  const barColor =
    status === 'success' ? 'dui:bg-success' : status === 'danger' ? 'dui:bg-destructive' : status === 'warning' ? 'dui:bg-warning' : 'dui:bg-primary'
  return (
    <div className={cn('dui:flex dui:w-full dui:items-center dui:gap-2', className)} style={style}>
      <div className="dui:h-1.5 dui:w-full dui:overflow-hidden dui:rounded-full dui:bg-secondary">
        <div className={cn('dui:h-full dui:rounded-full dui:transition-[width] dui:duration-200', barColor)} style={{ width: `${pct}%` }} />
      </div>
      {label ? <span className="dui:shrink-0 dui:text-xs dui:text-muted-foreground">{Math.round(pct)}%</span> : null}
    </div>
  )
}

/* ================= Steps ================= */
export interface StepsProps {
  current?: number
  layout?: 'horizontal' | 'vertical'
  options?: Array<{ title: React.ReactNode; description?: React.ReactNode }>
  children?: React.ReactNode
}
export function Steps({ current = 0, layout = 'horizontal', options = [] }: StepsProps) {
  return (
    <div className={cn('dui:flex dui:gap-4', layout === 'vertical' ? 'dui:flex-col' : 'dui:items-center')}>
      {options.map((it, idx) => {
        const state = idx < current ? 'finish' : idx === current ? 'current' : 'wait'
        return (
          <div key={idx} className={cn('dui:flex dui:items-center dui:gap-2 dui:text-sm', state !== 'wait' ? 'dui:text-foreground' : 'dui:text-muted-foreground')}>
            <span
              className={cn(
                'dui:flex dui:h-6 dui:w-6 dui:flex-none dui:items-center dui:justify-center dui:rounded-full dui:text-xs',
                state === 'current' && 'dui:bg-primary dui:text-primary-foreground',
                state === 'finish' && 'dui:bg-success dui:text-success-foreground',
                state === 'wait' && 'dui:bg-secondary dui:text-muted-foreground',
              )}
            >
              {state === 'finish' ? '✓' : idx + 1}
            </span>
            <span>{it.title}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ================= Tooltip ================= */
export interface TooltipProps {
  content?: React.ReactNode
  children?: React.ReactNode
  trigger?: 'hover' | 'click' | 'focus'
  placement?: string
  showArrow?: boolean
  destroyOnClose?: boolean
  theme?: 'default' | 'light' | 'primary'
  overlayInnerClassName?: string
}
export function Tooltip({ content, children, trigger = 'hover', overlayInnerClassName }: TooltipProps) {
  const [visible, setVisible] = React.useState(false)
  const ref = React.useRef<HTMLSpanElement>(null)
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null)

  const show = () => {
    setVisible(true)
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: r.top - 6 })
    }
  }
  const hide = () => setVisible(false)

  const bind =
    trigger === 'click' ? { onClick: () => (visible ? hide() : show()) } : { onMouseEnter: show, onMouseLeave: hide }

  return (
    <span ref={ref} style={{ display: 'inline-flex' }} {...bind}>
      {children}
      {visible && content && pos ? (
        <span
          className={cn(
            'dui:pointer-events-none dui:fixed dui:z-50 dui:max-w-[320px] dui--translate-x-1/2 dui:rounded-md dui:border dui:border-border dui:bg-popover dui:px-3 dui:py-1.5 dui:text-xs dui:text-popover-foreground dui:shadow-md',
            overlayInnerClassName,
          )}
          style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          {content}
        </span>
      ) : null}
    </span>
  )
}

export { Tooltip as Popup }
