"use client"

import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "../../lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "dui:flex dui:h-full dui:w-full dui:aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "dui:relative dui:flex dui:w-px dui:items-center dui:justify-center dui:bg-border dui:ring-offset-background dui:after:absolute dui:after:inset-y-0 dui:after:start-1/2 dui:after:w-1 dui:after:-translate-x-1/2 rtl:dui:after:translate-x-1/2 dui:focus-visible:ring-1 dui:focus-visible:ring-ring dui:focus-visible:outline-hidden dui:aria-[orientation=horizontal]:h-px dui:aria-[orientation=horizontal]:w-full dui:aria-[orientation=horizontal]:after:start-0 dui:aria-[orientation=horizontal]:after:h-1 dui:aria-[orientation=horizontal]:after:w-full dui:aria-[orientation=horizontal]:after:translate-x-0 rtl:dui:aria-[orientation=horizontal]:after:-translate-x-0 dui:aria-[orientation=horizontal]:after:-translate-y-1/2 dui:[&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="dui:z-10 dui:flex dui:h-6 dui:w-1 dui:shrink-0 dui:rounded-lg dui:bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
