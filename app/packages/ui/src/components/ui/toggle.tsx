import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

const toggleVariants = cva(
  "dui:group/toggle dui:inline-flex dui:items-center dui:justify-center dui:gap-1 dui:rounded-md dui:text-xs dui:font-medium dui:whitespace-nowrap dui:transition-all dui:outline-none dui:hover:bg-muted dui:hover:text-foreground dui:focus-visible:border-ring dui:focus-visible:ring-[3px] dui:focus-visible:ring-ring/50 dui:disabled:pointer-events-none dui:disabled:opacity-50 dui:aria-invalid:border-destructive dui:aria-invalid:ring-destructive/20 dui:aria-pressed:bg-muted dui:data-[state=on]:bg-muted dui:dark:aria-invalid:ring-destructive/40 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "dui:bg-transparent",
        outline: "dui:border dui:border-input dui:bg-transparent dui:hover:bg-muted",
      },
      size: {
        default:
          "dui:h-7 dui:min-w-7 dui:px-2 dui:has-data-[icon=inline-end]:pe-1.5 dui:has-data-[icon=inline-start]:ps-1.5",
        sm: "dui:h-6 dui:min-w-6 dui:rounded-[min(var(--radius-md),8px)] dui:px-2 dui:text-[0.625rem] dui:has-data-[icon=inline-end]:pe-1.5 dui:has-data-[icon=inline-start]:ps-1.5 dui:[&_svg:not([class*=size-])]:size-3",
        lg: "dui:h-8 dui:min-w-8 dui:px-2.5 dui:has-data-[icon=inline-end]:pe-2 dui:has-data-[icon=inline-start]:ps-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
// 兼容类型（旧 API 面）
export type ToggleSize = VariantProps<typeof toggleVariants>["size"]
