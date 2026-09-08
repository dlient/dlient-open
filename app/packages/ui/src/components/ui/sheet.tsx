import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { Button } from "./button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  const container = usePluginPortalContainer()
  return <SheetPrimitive.Portal data-slot="sheet-portal" container={container} {...props} />
}

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    data-slot="sheet-overlay"
    className={cn(
      "dui:fixed dui:inset-0 dui:z-50 dui:bg-black/80 dui:duration-100 dui:supports-backdrop-filter:backdrop-blur-xs dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-closed:animate-out dui:data-closed:fade-out-0",
      className
    )}
    {...props}
  />
))
SheetOverlay.displayName = "SheetOverlay"

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "dui:fixed dui:z-50 dui:flex dui:flex-col dui:bg-popover dui:bg-clip-padding dui:text-xs/relaxed dui:text-popover-foreground dui:shadow-lg dui:transition dui:duration-200 dui:ease-in-out dui:data-[side=bottom]:inset-x-0 dui:data-[side=bottom]:bottom-0 dui:data-[side=bottom]:h-auto dui:data-[side=bottom]:border-t dui:data-[side=left]:inset-y-0 dui:data-[side=left]:left-0 dui:data-[side=left]:h-full dui:data-[side=left]:w-3/4 dui:data-[side=left]:border-e dui:data-[side=right]:inset-y-0 dui:data-[side=right]:right-0 dui:data-[side=right]:h-full dui:data-[side=right]:w-3/4 dui:data-[side=right]:border-s dui:data-[side=top]:inset-x-0 dui:data-[side=top]:top-0 dui:data-[side=top]:h-auto dui:data-[side=top]:border-b dui:data-[side=left]:sm:max-w-sm dui:data-[side=right]:sm:max-w-sm dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-[side=bottom]:data-open:slide-in-from-bottom-10 dui:data-[side=left]:data-open:slide-in-from-left-10 dui:data-[side=right]:data-open:slide-in-from-right-10 dui:data-[side=top]:data-open:slide-in-from-top-10 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-[side=bottom]:data-closed:slide-out-to-bottom-10 dui:data-[side=left]:data-closed:slide-out-to-left-10 dui:data-[side=right]:data-closed:slide-out-to-right-10 dui:data-[side=top]:data-closed:slide-out-to-top-10",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="dui:absolute dui:top-4 dui:end-4"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="dui:sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("dui:flex dui:flex-col dui:gap-1.5 dui:p-6", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("dui:mt-auto dui:flex dui:flex-col dui:gap-2 dui:p-6", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "dui:font-heading dui:text-sm dui:font-medium dui:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("dui:text-xs/relaxed dui:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
