import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const alertVariants = cva(
  "dui:group/alert dui:relative dui:grid dui:w-full dui:gap-0.5 dui:rounded-lg dui:border dui:px-2 dui:py-1.5 dui:text-start dui:text-xs/relaxed dui:has-data-[slot=alert-action]:relative dui:has-data-[slot=alert-action]:pe-18 dui:has-[>svg]:grid-cols-[auto_1fr] dui:has-[>svg]:gap-x-1.5 dui:*:[svg]:row-span-2 dui:*:[svg]:translate-y-0.5 dui:*:[svg]:text-current dui:*:[svg:not([class*=size-])]:size-3.5",
  {
    variants: {
      variant: {
        default: "dui:bg-card dui:text-card-foreground",
        destructive:
          "dui:bg-card dui:text-destructive dui:*:data-[slot=alert-description]:text-destructive/90 dui:*:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "dui:font-medium dui:group-has-[>svg]/alert:col-start-2 dui:[&_a]:underline dui:[&_a]:underline-offset-3 dui:[&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "dui:text-xs/relaxed dui:text-balance dui:text-muted-foreground dui:md:text-pretty dui:[&_a]:underline dui:[&_a]:underline-offset-3 dui:[&_a]:hover:text-foreground dui:[&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("dui:absolute dui:top-1.5 dui:end-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
// 兼容类型（旧 API 面）
export type AlertVariant = VariantProps<typeof alertVariants>["variant"]
