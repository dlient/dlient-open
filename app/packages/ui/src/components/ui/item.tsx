import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"
import { Separator } from "./separator"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn(
        "dui:group/item-group dui:flex dui:w-full dui:flex-col dui:gap-4 dui:has-data-[size=sm]:gap-2.5 dui:has-data-[size=xs]:gap-2",
        className
      )}
      {...props}
    />
  )
}

function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn("dui:my-2", className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  "dui:group/item dui:flex dui:w-full dui:flex-wrap dui:items-center dui:rounded-md dui:border dui:text-xs/relaxed dui:transition-colors dui:duration-100 dui:outline-none dui:focus-visible:border-ring dui:focus-visible:ring-[3px] dui:focus-visible:ring-ring/50 dui:[a]:transition-colors dui:[a]:hover:bg-muted",
  {
    variants: {
      variant: {
        default: "dui:border-transparent",
        outline: "dui:border-border",
        muted: "dui:border-transparent dui:bg-muted/50",
      },
      size: {
        default: "dui:gap-2.5 dui:px-3 dui:py-2.5",
        sm: "dui:gap-2.5 dui:px-3 dui:py-2.5",
        xs: "dui:gap-2.5 dui:px-2.5 dui:py-2 dui:in-data-[slot=dropdown-menu-content]:p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Item = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & VariantProps<typeof itemVariants> & { asChild?: boolean }
>(function Item({ className, variant = "default", size = "default", asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      ref={ref as never}
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(itemVariants({ variant, size, className }))}
      {...props}
    />
  )
})
Item.displayName = "Item"

const itemMediaVariants = cva(
  "dui:flex dui:shrink-0 dui:items-center dui:justify-center dui:gap-2 dui:group-has-data-[slot=item-description]/item:translate-y-0.5 dui:group-has-data-[slot=item-description]/item:self-start dui:[&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "dui:bg-transparent",
        icon: "dui:[&_svg:not([class*=size-])]:size-4",
        image:
          "dui:size-8 dui:overflow-hidden dui:rounded-sm dui:group-data-[size=sm]/item:size-8 dui:group-data-[size=xs]/item:size-6 dui:[&_img]:size-full dui:[&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "dui:flex dui:flex-1 dui:flex-col dui:gap-1 dui:group-data-[size=xs]/item:gap-0.5 dui:[&+[data-slot=item-content]]:flex-none",
        className
      )}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        "dui:line-clamp-1 dui:flex dui:w-fit dui:items-center dui:gap-2 dui:text-xs/relaxed dui:leading-snug dui:font-medium dui:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "dui:line-clamp-2 dui:text-start dui:text-xs/relaxed dui:font-normal dui:text-muted-foreground dui:[&>a]:underline dui:[&>a]:underline-offset-4 dui:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("dui:flex dui:items-center dui:gap-2", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        "dui:flex dui:basis-full dui:items-center dui:justify-between dui:gap-2",
        className
      )}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        "dui:flex dui:basis-full dui:items-center dui:justify-between dui:gap-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
}
