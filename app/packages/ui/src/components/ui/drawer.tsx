import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  const container = usePluginPortalContainer()
  return <DrawerPrimitive.Portal data-slot="drawer-portal" container={container} {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "dui:fixed dui:inset-0 dui:z-50 dui:bg-black/80 dui:supports-backdrop-filter:backdrop-blur-xs dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-closed:animate-out dui:data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "dui:group/drawer-content dui:fixed dui:z-50 dui:flex dui:h-auto dui:flex-col dui:bg-transparent dui:p-2 dui:text-xs/relaxed dui:text-popover-foreground dui:before:absolute dui:before:inset-2 dui:before:-z-10 dui:before:rounded-xl dui:before:border dui:before:border-border dui:before:bg-popover dui:data-[vaul-drawer-direction=bottom]:inset-x-0 dui:data-[vaul-drawer-direction=bottom]:bottom-0 dui:data-[vaul-drawer-direction=bottom]:mt-24 dui:data-[vaul-drawer-direction=bottom]:max-h-[80vh] dui:data-[vaul-drawer-direction=left]:inset-y-0 dui:data-[vaul-drawer-direction=left]:start-0 dui:data-[vaul-drawer-direction=left]:w-3/4 dui:data-[vaul-drawer-direction=right]:inset-y-0 dui:data-[vaul-drawer-direction=right]:end-0 dui:data-[vaul-drawer-direction=right]:w-3/4 dui:data-[vaul-drawer-direction=top]:inset-x-0 dui:data-[vaul-drawer-direction=top]:top-0 dui:data-[vaul-drawer-direction=top]:mb-24 dui:data-[vaul-drawer-direction=top]:max-h-[80vh] dui:data-[vaul-drawer-direction=left]:sm:max-w-sm dui:data-[vaul-drawer-direction=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        <div className="dui:mx-auto dui:mt-4 dui:hidden dui:h-1.5 dui:w-[100px] dui:shrink-0 dui:rounded-full dui:bg-muted dui:group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "dui:flex dui:flex-col dui:gap-1 dui:p-4 dui:group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center dui:group-data-[vaul-drawer-direction=top]/drawer-content:text-center dui:md:text-start",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("dui:mt-auto dui:flex dui:flex-col dui:gap-2 dui:p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn(
        "dui:font-heading dui:text-sm dui:font-medium dui:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("dui:text-xs/relaxed dui:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
