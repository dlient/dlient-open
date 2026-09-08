import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      className={cn(className)}
      {...props}
    />
  )
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "dui:flex dui:flex-wrap dui:items-center dui:gap-1.5 dui:text-xs/relaxed dui:wrap-break-word dui:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("dui:inline-flex dui:items-center dui:gap-1", className)}
      {...props}
    />
  )
}

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a"> & { asChild?: boolean }>(
  function BreadcrumbLink({ asChild, className, ...props }, ref) {
    const Comp = asChild ? Slot.Root : "a"

    return (
      <Comp
        ref={ref as never}
        data-slot="breadcrumb-link"
        className={cn("dui:transition-colors dui:hover:text-foreground", className)}
        {...props}
      />
    )
  }
)
BreadcrumbLink.displayName = "BreadcrumbLink"

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("dui:font-normal dui:text-foreground", className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("dui:[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? (
        <ChevronRightIcon />
      )}
    </li>
  )
}

function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn(
        "dui:flex dui:size-4 dui:items-center dui:justify-center dui:[&>svg]:size-3.5",
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon
      />
      <span className="dui:sr-only">More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}
