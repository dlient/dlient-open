import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"

const markerVariants = cva(
  "dui:group/marker dui:relative dui:flex dui:min-h-4 dui:w-full dui:items-center dui:gap-2 dui:text-start dui:text-xs/relaxed dui:text-muted-foreground dui:[&_svg:not([class*=size-])]:size-3.5 dui:[a]:underline dui:[a]:underline-offset-3 dui:[a]:hover:text-foreground",
  {
    variants: {
      variant: {
        default: "dui:",
        separator:
          "dui:before:me-1 dui:before:h-px dui:before:min-w-0 dui:before:flex-1 dui:before:bg-border dui:after:ms-1 dui:after:h-px dui:after:min-w-0 dui:after:flex-1 dui:after:bg-border",
        border: "dui:border-b dui:border-border dui:pb-2",
      },
    },
  }
)

const Marker = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> &
    VariantProps<typeof markerVariants> & {
      asChild?: boolean
    }
>(function Marker({ className, variant = "default", asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "div"

  return (
    <Comp
      ref={ref as never}
      data-slot="marker"
      data-variant={variant}
      className={cn(markerVariants({ variant, className }))}
      {...props}
    />
  )
})
Marker.displayName = "Marker"

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn(
        "dui:size-3.5 dui:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "dui:min-w-0 dui:wrap-break-word dui:group-data-[variant=separator]/marker:flex-none dui:group-data-[variant=separator]/marker:text-center dui:*:[a]:underline dui:*:[a]:underline-offset-3 dui:*:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Marker, MarkerIcon, MarkerContent, markerVariants }
