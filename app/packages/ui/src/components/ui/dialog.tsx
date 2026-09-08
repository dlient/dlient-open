"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { Button } from "./button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const container = usePluginPortalContainer()
  return <DialogPrimitive.Portal data-slot="dialog-portal" container={container} {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      "dui:fixed dui:inset-0 dui:isolate dui:z-50 dui:bg-black/80 dui:duration-100 dui:supports-backdrop-filter:backdrop-blur-xs dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-closed:animate-out dui:data-closed:fade-out-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = "DialogOverlay"

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "dui:fixed dui:top-1/2 dui:start-1/2 dui:z-50 dui:grid dui:w-full dui:max-w-[calc(100%-2rem)] dui:-translate-x-1/2 rtl:dui:translate-x-1/2 dui:-translate-y-1/2 dui:gap-4 dui:rounded-xl dui:bg-popover dui:p-4 dui:text-xs/relaxed dui:text-popover-foreground dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:outline-none dui:sm:max-w-sm dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="dui:absolute dui:top-2 dui:end-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="dui:sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("dui:flex dui:flex-col dui:gap-1", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "dui:flex dui:flex-col-reverse dui:gap-2 dui:sm:flex-row dui:sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("dui:font-heading dui:text-sm dui:font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "dui:text-xs/relaxed dui:text-muted-foreground dui:*:[a]:underline dui:*:[a]:underline-offset-3 dui:*:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
