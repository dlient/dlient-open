import * as React from "react"
import { cva } from "class-variance-authority"
import { NavigationMenu as NavigationMenuPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { ChevronDownIcon } from "lucide-react"

function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root> & {
  viewport?: boolean
}) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      data-viewport={viewport}
      className={cn(
        "dui:group/navigation-menu dui:relative dui:flex dui:max-w-max dui:flex-1 dui:items-center dui:justify-center",
        className
      )}
      {...props}
    >
      {children}
      {viewport && <NavigationMenuViewport />}
    </NavigationMenuPrimitive.Root>
  )
}

function NavigationMenuList({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn(
        "dui:group dui:flex dui:flex-1 dui:list-none dui:items-center dui:justify-center dui:gap-0",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot="navigation-menu-item"
      className={cn("dui:relative", className)}
      {...props}
    />
  )
}

const navigationMenuTriggerStyle = cva(
  "dui:group/navigation-menu-trigger dui:inline-flex dui:h-9 dui:w-max dui:items-center dui:justify-center dui:rounded-lg dui:px-2.5 dui:py-1.5 dui:text-xs/relaxed dui:font-medium dui:transition-all dui:outline-none dui:hover:bg-muted dui:focus:bg-muted dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:focus-visible:outline-1 dui:disabled:pointer-events-none dui:disabled:opacity-50 dui:data-popup-open:bg-muted/50 dui:data-popup-open:hover:bg-muted dui:data-open:bg-muted/50 dui:data-open:hover:bg-muted dui:data-open:focus:bg-muted"
)

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot="navigation-menu-trigger"
      className={cn(navigationMenuTriggerStyle(), "dui:group", className)}
      {...props}
    >
      {children}{" "}
      <ChevronDownIcon className="dui:relative dui:top-px dui:ms-1 dui:size-3 dui:transition dui:duration-300 dui:group-data-popup-open/navigation-menu-trigger:rotate-180 dui:group-data-open/navigation-menu-trigger:rotate-180" aria-hidden="true" />
    </NavigationMenuPrimitive.Trigger>
  )
}

function NavigationMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
  return (
    <NavigationMenuPrimitive.Content
      data-slot="navigation-menu-content"
      className={cn(
        "dui:top-0 dui:start-0 dui:w-full dui:p-1.5 dui:ease-[cubic-bezier(0.22,1,0.36,1)] dui:group-data-[viewport=false]/navigation-menu:top-full dui:group-data-[viewport=false]/navigation-menu:mt-1.5 dui:group-data-[viewport=false]/navigation-menu:overflow-hidden dui:group-data-[viewport=false]/navigation-menu:rounded-xl dui:group-data-[viewport=false]/navigation-menu:bg-popover dui:group-data-[viewport=false]/navigation-menu:text-popover-foreground dui:group-data-[viewport=false]/navigation-menu:shadow-md dui:group-data-[viewport=false]/navigation-menu:ring-1 dui:group-data-[viewport=false]/navigation-menu:ring-foreground/10 dui:group-data-[viewport=false]/navigation-menu:duration-300 dui:data-[motion=from-end]:slide-in-from-right-52 dui:data-[motion=from-start]:slide-in-from-left-52 dui:data-[motion=to-end]:slide-out-to-right-52 dui:data-[motion=to-start]:slide-out-to-left-52 dui:data-[motion^=from-]:animate-in dui:data-[motion^=from-]:fade-in dui:data-[motion^=to-]:animate-out dui:data-[motion^=to-]:fade-out dui:**:data-[slot=navigation-menu-link]:focus:ring-0 dui:**:data-[slot=navigation-menu-link]:focus:outline-none dui:md:absolute dui:md:w-auto dui:group-data-[viewport=false]/navigation-menu:data-open:animate-in dui:group-data-[viewport=false]/navigation-menu:data-open:fade-in-0 dui:group-data-[viewport=false]/navigation-menu:data-open:zoom-in-95 dui:group-data-[viewport=false]/navigation-menu:data-closed:animate-out dui:group-data-[viewport=false]/navigation-menu:data-closed:fade-out-0 dui:group-data-[viewport=false]/navigation-menu:data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuViewport({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
  return (
    <div
      className={cn(
        "dui:absolute dui:top-full dui:start-0 dui:isolate dui:z-50 dui:flex dui:justify-center"
      )}
    >
      <NavigationMenuPrimitive.Viewport
        data-slot="navigation-menu-viewport"
        className={cn(
          "dui:origin-top-center dui:relative dui:mt-1.5 dui:h-(--radix-navigation-menu-viewport-height) dui:w-full dui:overflow-hidden dui:rounded-xl dui:bg-popover dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:md:w-(--radix-navigation-menu-viewport-width) dui:data-open:animate-in dui:data-open:zoom-in-90 dui:data-closed:animate-out dui:data-closed:zoom-out-90",
          className
        )}
        {...props}
      />
    </div>
  )
}

function NavigationMenuLink({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      className={cn(
        "dui:flex dui:items-center dui:gap-1.5 dui:rounded-lg dui:p-2 dui:text-xs/relaxed dui:transition-all dui:outline-none dui:hover:bg-muted dui:focus:bg-muted dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:focus-visible:outline-1 dui:in-data-[slot=navigation-menu-content]:rounded-md dui:data-[active=true]:bg-muted/50 dui:data-[active=true]:hover:bg-muted dui:data-[active=true]:focus:bg-muted dui:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuIndicator({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Indicator>) {
  return (
    <NavigationMenuPrimitive.Indicator
      data-slot="navigation-menu-indicator"
      className={cn(
        "dui:top-full dui:z-1 dui:flex dui:h-1.5 dui:items-end dui:justify-center dui:overflow-hidden dui:data-[state=hidden]:animate-out dui:data-[state=hidden]:fade-out dui:data-[state=visible]:animate-in dui:data-[state=visible]:fade-in",
        className
      )}
      {...props}
    >
      <div className="dui:relative dui:top-[60%] dui:h-2 dui:w-2 dui:rotate-45 dui:rounded-ss-sm dui:bg-border dui:shadow-md" />
    </NavigationMenuPrimitive.Indicator>
  )
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
}
