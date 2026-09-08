import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const container = usePluginPortalContainer()
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "dui:z-50 dui:flex dui:w-72 dui:origin-(--radix-popover-content-transform-origin) dui:flex-col dui:gap-4 dui:rounded-lg dui:bg-popover dui:p-2.5 dui:text-xs dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:outline-hidden dui:duration-100 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("dui:flex dui:flex-col dui:gap-1 dui:text-xs", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("dui:text-sm dui:font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("dui:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
