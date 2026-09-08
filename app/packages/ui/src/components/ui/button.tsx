import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { Loader2Icon } from "lucide-react"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "dui:cursor-pointer dui:group/button dui:inline-flex dui:shrink-0 dui:items-center dui:justify-center dui:rounded-md dui:border dui:border-transparent dui:bg-clip-padding dui:text-xs/relaxed dui:font-medium dui:whitespace-nowrap dui:transition-all dui:outline-none dui:select-none dui:focus-visible:border-ring dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:active:not-aria-[haspopup]:translate-y-px dui:disabled:pointer-events-none dui:disabled:opacity-50 dui:aria-invalid:border-destructive dui:aria-invalid:ring-2 dui:aria-invalid:ring-destructive/20 dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "dui:bg-primary dui:text-primary-foreground dui:hover:bg-primary/80",
        outline:
          "dui:border-border dui:hover:bg-input/50 dui:hover:text-foreground dui:aria-expanded:bg-muted dui:aria-expanded:text-foreground dui:dark:bg-input/30",
        secondary:
          "dui:bg-secondary dui:text-secondary-foreground dui:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dui:aria-expanded:bg-secondary dui:aria-expanded:text-secondary-foreground",
        ghost:
          "dui:hover:bg-muted dui:hover:text-foreground dui:aria-expanded:bg-muted dui:aria-expanded:text-foreground dui:dark:hover:bg-muted/50",
        destructive:
          "dui:bg-destructive/10 dui:text-destructive dui:hover:bg-destructive/20 dui:focus-visible:border-destructive/40 dui:focus-visible:ring-destructive/20 dui:dark:bg-destructive/20 dui:dark:hover:bg-destructive/30 dui:dark:focus-visible:ring-destructive/40",
        // tdesign 语义实心色（theme 映射目标）：复用包内 --success / --warning / --destructive 变量
        success:
          "dui:bg-success dui:text-success-foreground dui:hover:bg-success/85 dui:dark:hover:bg-success/80",
        warning:
          "dui:bg-warning dui:text-warning-foreground dui:hover:bg-warning/85 dui:dark:hover:bg-warning/80",
        error:
          "dui:bg-destructive dui:text-destructive-foreground dui:hover:bg-destructive/90",
        link: "dui:text-primary dui:underline-offset-4 dui:hover:underline",
      },
      size: {
        default:
          "dui:h-7 dui:gap-1 dui:px-2 dui:text-xs/relaxed dui:has-data-[icon=inline-end]:pe-1.5 dui:has-data-[icon=inline-start]:ps-1.5 dui:[&_svg:not([class*=size-])]:size-3.5",
        xs: "dui:h-5 dui:gap-1 dui:rounded-sm dui:px-2 dui:text-[0.625rem] dui:has-data-[icon=inline-end]:pe-1.5 dui:has-data-[icon=inline-start]:ps-1.5 dui:[&_svg:not([class*=size-])]:size-2.5",
        sm: "dui:h-6 dui:gap-1 dui:px-2 dui:text-xs/relaxed dui:has-data-[icon=inline-end]:pe-1.5 dui:has-data-[icon=inline-start]:ps-1.5 dui:[&_svg:not([class*=size-])]:size-3",
        lg: "dui:h-8 dui:gap-1 dui:px-2.5 dui:text-xs/relaxed dui:has-data-[icon=inline-end]:pe-2 dui:has-data-[icon=inline-start]:ps-2 dui:[&_svg:not([class*=size-])]:size-4",
        icon: "dui:size-7 dui:[&_svg:not([class*=size-])]:size-3.5",
        "icon-xs": "dui:size-5 dui:rounded-sm dui:[&_svg:not([class*=size-])]:size-2.5",
        "icon-sm": "dui:size-6 dui:[&_svg:not([class*=size-])]:size-3",
        "icon-lg": "dui:size-8 dui:[&_svg:not([class*=size-])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// tdesign 风格 theme → variant 映射（theme 与 variant 二选一，theme 优先）
const THEME_TO_VARIANT = {
  default: "secondary",
  primary: "default",
  success: "success",
  warning: "warning",
  error: "error",
  danger: "error",
} as const

export type ButtonTheme = keyof typeof THEME_TO_VARIANT

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "default",
    size = "default",
    asChild = false,
    loading,
    theme,
    children,
    ...props
  },
  ref,
) {
  const busy = Boolean(loading)
  const effectiveVariant = theme ? THEME_TO_VARIANT[theme] : variant
  const { disabled, ...rest } = props
  const common = {
    "data-slot": "button",
    "data-variant": effectiveVariant,
    "data-size": size,
    disabled: disabled || busy,
    className: cn(buttonVariants({ variant: effectiveVariant, size }), busy && "dui:pointer-events-none dui:opacity-70 dui:select-none", className),
  }

  // asChild（Slot）要求 children 为单一 React 元素，不能拼接额外节点（含 null/false），
  // 因此 loading 转圈图标只在原生 button 分支渲染；disabled 经 spread 透传（JSX spread 不校验多余属性）。
  if (asChild) {
    return (
      <Slot.Root ref={ref as React.Ref<HTMLElement>} {...common} {...rest}>
        {children}
      </Slot.Root>
    )
  }

  return (
    <button ref={ref} {...common} {...rest}>
      {busy ? <Loader2Icon aria-hidden="true" className="dui:size-4 dui:animate-spin" /> : null}
      {children}
    </button>
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
// 兼容类型（旧 API 面）
export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** tdesign 风格语义主题（优先于 variant） */
    theme?: ButtonTheme
    loading?: boolean
  }
export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"]
export type ButtonSize = VariantProps<typeof buttonVariants>["size"]
