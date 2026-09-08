import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "dui:group/badge dui:inline-flex dui:h-5 dui:w-fit dui:shrink-0 dui:items-center dui:justify-center dui:gap-1 dui:overflow-hidden dui:rounded-full dui:border dui:border-transparent dui:px-2 dui:py-0.5 dui:text-[0.625rem] dui:font-medium dui:whitespace-nowrap dui:transition-all dui:focus-visible:border-ring dui:focus-visible:ring-[3px] dui:focus-visible:ring-ring/50 dui:has-data-[icon=inline-end]:pe-1.5 dui:has-data-[icon=inline-start]:ps-1.5 dui:aria-invalid:border-destructive dui:aria-invalid:ring-destructive/20 dui:dark:aria-invalid:ring-destructive/40 dui:[&>svg]:pointer-events-none dui:[&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "dui:bg-primary dui:text-primary-foreground dui:[a]:hover:bg-primary/80",
        secondary:
          "dui:bg-secondary dui:text-secondary-foreground dui:[a]:hover:bg-secondary/80",
        destructive:
          "dui:bg-destructive/10 dui:text-destructive dui:focus-visible:ring-destructive/20 dui:dark:bg-destructive/20 dui:dark:focus-visible:ring-destructive/40 dui:[a]:hover:bg-destructive/20",
        // tdesign 语义实心色（Tag theme 映射目标）：复用包内 --success / --warning 变量
        success: "dui:bg-success dui:text-success-foreground",
        warning: "dui:bg-warning dui:text-warning-foreground",
        outline:
          "dui:border-border dui:bg-input/20 dui:text-foreground dui:dark:bg-input/30 dui:[a]:hover:bg-muted dui:[a]:hover:text-muted-foreground",
        ghost:
          "dui:hover:bg-muted dui:hover:text-muted-foreground dui:dark:hover:bg-muted/50",
        link: "dui:text-primary dui:underline-offset-4 dui:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Badge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }
>(function Badge({ className, variant = "default", asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      ref={ref as never}
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
})
Badge.displayName = "Badge"

export { Badge, badgeVariants }
// 兼容类型（旧 API 面）
export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }
export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"]
