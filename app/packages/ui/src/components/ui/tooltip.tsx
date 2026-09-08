"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const container = usePluginPortalContainer()
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "dui:z-50 dui:inline-flex dui:w-fit dui:max-w-xs dui:origin-(--radix-tooltip-content-transform-origin) dui:items-center dui:gap-1.5 dui:rounded-md dui:bg-foreground dui:px-3 dui:py-1.5 dui:text-xs dui:text-background dui:has-data-[slot=kbd]:pe-1.5 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:**:data-[slot=kbd]:relative dui:**:data-[slot=kbd]:isolate dui:**:data-[slot=kbd]:z-50 dui:**:data-[slot=kbd]:rounded-sm dui:data-[state=delayed-open]:animate-in dui:data-[state=delayed-open]:fade-in-0 dui:data-[state=delayed-open]:zoom-in-95 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="dui:z-50 dui:size-2.5 dui:translate-y-[calc(-50%_-_2px)] dui:rotate-45 dui:rounded-[2px] dui:bg-foreground dui:fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
