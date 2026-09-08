import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

// 兼容旧 display.Empty 的便捷 props（插件按 tdesign 风格使用）
export interface EmptyLegacyProps {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
}

function Empty({
  className,
  icon,
  title,
  description,
  action,
  children,
  ...props
}: React.ComponentProps<"div"> & EmptyLegacyProps) {
  const hasLegacy = icon != null || title != null || description != null || action != null
  if (hasLegacy) {
    return (
      <div
        data-slot="empty"
        className={cn(
          "dui:flex dui:w-full dui:min-w-0 dui:flex-1 dui:flex-col dui:items-center dui:justify-center dui:gap-4 dui:rounded-xl dui:border-dashed dui:p-6 dui:text-center dui:text-balance",
          className
        )}
        {...props}
      >
        <EmptyHeader>
          {icon != null ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
          {title != null ? <EmptyTitle>{title}</EmptyTitle> : null}
          {description != null ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
        {action != null ? action : null}
      </div>
    )
  }
  return (
    <div
      data-slot="empty"
      className={cn(
        "dui:flex dui:w-full dui:min-w-0 dui:flex-1 dui:flex-col dui:items-center dui:justify-center dui:gap-4 dui:rounded-xl dui:border-dashed dui:p-6 dui:text-center dui:text-balance",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("dui:flex dui:max-w-sm dui:flex-col dui:items-center dui:gap-1", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "dui:mb-2 dui:flex dui:shrink-0 dui:items-center dui:justify-center dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "dui:bg-transparent",
        icon: "dui:flex dui:size-8 dui:shrink-0 dui:items-center dui:justify-center dui:rounded-md dui:bg-muted dui:text-foreground dui:[&_svg:not([class*=size-])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "dui:font-heading dui:text-sm dui:font-medium dui:tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "dui:text-xs/relaxed dui:text-muted-foreground dui:[&>a]:underline dui:[&>a]:underline-offset-4 dui:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "dui:flex dui:w-full dui:max-w-sm dui:min-w-0 dui:flex-col dui:items-center dui:gap-2 dui:text-xs/relaxed dui:text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
