import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { useIsMobile } from "../../hooks/use-mobile"
import { cn } from "../../lib/utils"
import { Button } from "./button"
import { Input } from "./input"
import { Separator } from "./separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./sheet"
import { Skeleton } from "./skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./tooltip"
import { PanelLeftIcon } from "lucide-react"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "dui:group/sidebar-wrapper dui:flex dui:min-h-svh dui:w-full dui:has-data-[variant=inset]:bg-sidebar",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "dui:flex dui:h-full dui:w-(--sidebar-width) dui:flex-col dui:bg-sidebar dui:text-sidebar-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="dui:w-(--sidebar-width) dui:bg-sidebar dui:p-0 dui:text-sidebar-foreground dui:[&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="dui:sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="dui:flex dui:h-full dui:w-full dui:flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="dui:group dui:peer dui:hidden dui:text-sidebar-foreground dui:md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "dui:relative dui:w-(--sidebar-width) dui:bg-transparent dui:transition-[width] dui:duration-200 dui:ease-linear",
          "dui:group-data-[collapsible=offcanvas]:w-0",
          "dui:group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "dui:group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "dui:group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "dui:fixed dui:inset-y-0 dui:z-10 dui:hidden dui:h-svh dui:w-(--sidebar-width) dui:transition-[left,right,width] dui:duration-200 dui:ease-linear dui:data-[side=left]:left-0 dui:data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] dui:data-[side=right]:right-0 dui:data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] dui:md:flex",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "dui:p-2 dui:group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "dui:group-data-[collapsible=icon]:w-(--sidebar-width-icon) dui:group-data-[side=left]:border-e dui:group-data-[side=right]:border-s",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="dui:flex dui:size-full dui:flex-col dui:bg-sidebar dui:group-data-[variant=floating]:rounded-lg dui:group-data-[variant=floating]:shadow-sm dui:group-data-[variant=floating]:ring-1 dui:group-data-[variant=floating]:ring-sidebar-border"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="dui:sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "dui:absolute dui:inset-y-0 dui:z-20 dui:hidden dui:w-4 dui:transition-all dui:ease-linear dui:group-data-[side=left]:-right-4 dui:group-data-[side=right]:left-0 dui:after:absolute dui:after:inset-y-0 dui:after:start-1/2 dui:after:w-[2px] dui:hover:after:bg-sidebar-border dui:sm:flex dui:ltr:-translate-x-1/2 rtl:dui:ltr:translate-x-1/2 dui:rtl:-translate-x-1/2 rtl:dui:rtl:translate-x-1/2",
        "dui:in-data-[side=left]:cursor-w-resize rtl:dui:in-data-[side=left]:cursor-e-resize dui:in-data-[side=right]:cursor-e-resize rtl:dui:in-data-[side=right]:cursor-w-resize",
        "dui:[[data-side=left][data-state=collapsed]_&]:cursor-e-resize rtl:dui:[[data-side=left][data-state=collapsed]_&]:cursor-w-resize dui:[[data-side=right][data-state=collapsed]_&]:cursor-w-resize rtl:dui:[[data-side=right][data-state=collapsed]_&]:cursor-e-resize",
        "dui:group-data-[collapsible=offcanvas]:translate-x-0 rtl:dui:group-data-[collapsible=offcanvas]:-translate-x-0 dui:group-data-[collapsible=offcanvas]:after:start-full dui:hover:group-data-[collapsible=offcanvas]:bg-sidebar",
        "dui:[[data-side=left][data-collapsible=offcanvas]_&]:-end-2",
        "dui:[[data-side=right][data-collapsible=offcanvas]_&]:-start-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "dui:relative dui:flex dui:w-full dui:flex-1 dui:flex-col dui:bg-background dui:md:peer-data-[variant=inset]:m-2 dui:md:peer-data-[variant=inset]:ms-0 dui:md:peer-data-[variant=inset]:rounded-xl dui:md:peer-data-[variant=inset]:shadow-sm dui:md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn(
        "dui:h-8 dui:w-full dui:border-input dui:bg-muted/20 dui:dark:bg-muted/30",
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("dui:flex dui:flex-col dui:gap-2 dui:p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("dui:flex dui:flex-col dui:gap-2 dui:p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("dui:mx-2 dui:w-auto dui:bg-sidebar-border", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "dui:no-scrollbar dui:flex dui:min-h-0 dui:flex-1 dui:flex-col dui:gap-0 dui:overflow-auto dui:group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn(
        "dui:relative dui:flex dui:w-full dui:min-w-0 dui:flex-col dui:px-2 dui:py-1",
        className
      )}
      {...props}
    />
  )
}

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.ComponentProps<"div"> & { asChild?: boolean }>(
  function SidebarGroupLabel({ className, asChild = false, ...props }, ref) {
    const Comp = asChild ? Slot.Root : "div"

    return (
      <Comp
        ref={ref as never}
        data-slot="sidebar-group-label"
        data-sidebar="group-label"
        className={cn(
          "dui:flex dui:h-8 dui:shrink-0 dui:items-center dui:rounded-md dui:px-2 dui:text-xs dui:text-sidebar-foreground/70 dui:ring-sidebar-ring dui:outline-hidden dui:transition-[margin,opacity] dui:duration-200 dui:ease-linear dui:group-data-[collapsible=icon]:-mt-8 dui:group-data-[collapsible=icon]:opacity-0 dui:focus-visible:ring-2 dui:[&>svg]:size-4 dui:[&>svg]:shrink-0",
          className
        )}
        {...props}
      />
    )
  }
)
SidebarGroupLabel.displayName = "SidebarGroupLabel"

const SidebarGroupAction = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button"> & { asChild?: boolean }>(
  function SidebarGroupAction({ className, asChild = false, ...props }, ref) {
    const Comp = asChild ? Slot.Root : "button"

    return (
      <Comp
        ref={ref as never}
        data-slot="sidebar-group-action"
        data-sidebar="group-action"
        className={cn(
          "dui:absolute dui:top-3.5 dui:end-3 dui:flex dui:aspect-square dui:w-5 dui:items-center dui:justify-center dui:rounded-md dui:p-0 dui:text-sidebar-foreground dui:ring-sidebar-ring dui:outline-hidden dui:transition-transform dui:group-data-[collapsible=icon]:hidden dui:after:absolute dui:after:-inset-2 dui:hover:bg-sidebar-accent dui:hover:text-sidebar-accent-foreground dui:focus-visible:ring-2 dui:md:after:hidden dui:[&>svg]:size-4 dui:[&>svg]:shrink-0",
          className
        )}
        {...props}
      />
    )
  }
)
SidebarGroupAction.displayName = "SidebarGroupAction"

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("dui:w-full dui:text-xs", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("dui:flex dui:w-full dui:min-w-0 dui:flex-col dui:gap-px", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("dui:group/menu-item dui:relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "dui:peer/menu-button dui:group/menu-button dui:flex dui:w-full dui:items-center dui:gap-2 dui:overflow-hidden dui:rounded-[calc(var(--radius-sm)+2px)] dui:p-2 dui:text-start dui:text-xs dui:ring-sidebar-ring dui:outline-hidden dui:transition-[width,height,padding] dui:group-has-data-[sidebar=menu-action]/menu-item:pe-8 dui:group-data-[collapsible=icon]:size-8! dui:group-data-[collapsible=icon]:p-2! dui:hover:bg-sidebar-accent dui:hover:text-sidebar-accent-foreground dui:focus-visible:ring-2 dui:active:bg-sidebar-accent dui:active:text-sidebar-accent-foreground dui:disabled:pointer-events-none dui:disabled:opacity-50 dui:aria-disabled:pointer-events-none dui:aria-disabled:opacity-50 dui:data-open:hover:bg-sidebar-accent dui:data-open:hover:text-sidebar-accent-foreground dui:data-active:bg-sidebar-accent dui:data-active:font-medium dui:data-active:text-sidebar-accent-foreground dui:[&_svg]:size-4 dui:[&_svg]:shrink-0 dui:[&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "dui:hover:bg-sidebar-accent dui:hover:text-sidebar-accent-foreground",
        outline:
          "dui:bg-background dui:shadow-[0_0_0_1px_var(--sidebar-border)] dui:hover:bg-sidebar-accent dui:hover:text-sidebar-accent-foreground dui:hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "dui:h-8 dui:text-xs",
        sm: "dui:h-7 dui:text-xs",
        lg: "dui:h-12 dui:text-xs dui:group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  } & VariantProps<typeof sidebarMenuButtonVariants>
>(function SidebarMenuButton(
  { asChild = false, isActive = false, variant = "default", size = "default", tooltip, className, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      ref={ref as never}
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
})
SidebarMenuButton.displayName = "SidebarMenuButton"

const SidebarMenuAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean
    showOnHover?: boolean
  }
>(function SidebarMenuAction({ className, asChild = false, showOnHover = false, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref as never}
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "dui:absolute dui:top-1.5 dui:end-1 dui:flex dui:aspect-square dui:w-5 dui:items-center dui:justify-center dui:rounded-[calc(var(--radius-sm)-2px)] dui:p-0 dui:text-sidebar-foreground dui:ring-sidebar-ring dui:outline-hidden dui:transition-transform dui:group-data-[collapsible=icon]:hidden dui:peer-hover/menu-button:text-sidebar-accent-foreground dui:peer-data-[size=default]/menu-button:top-1.5 dui:peer-data-[size=lg]/menu-button:top-2.5 dui:peer-data-[size=sm]/menu-button:top-1 dui:after:absolute dui:after:-inset-2 dui:hover:bg-sidebar-accent dui:hover:text-sidebar-accent-foreground dui:focus-visible:ring-2 dui:md:after:hidden dui:[&>svg]:size-4 dui:[&>svg]:shrink-0",
        showOnHover &&
          "dui:group-focus-within/menu-item:opacity-100 dui:group-hover/menu-item:opacity-100 dui:peer-data-active/menu-button:text-sidebar-accent-foreground dui:aria-expanded:opacity-100 dui:md:opacity-0",
        className
      )}
      {...props}
    />
  )
})
SidebarMenuAction.displayName = "SidebarMenuAction"

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "dui:pointer-events-none dui:absolute dui:end-1 dui:flex dui:h-5 dui:min-w-5 dui:items-center dui:justify-center dui:rounded-[calc(var(--radius-sm)-2px)] dui:px-1 dui:text-xs dui:font-medium dui:text-sidebar-foreground dui:tabular-nums dui:select-none dui:group-data-[collapsible=icon]:hidden dui:peer-hover/menu-button:text-sidebar-accent-foreground dui:peer-data-[size=default]/menu-button:top-1.5 dui:peer-data-[size=lg]/menu-button:top-2.5 dui:peer-data-[size=sm]/menu-button:top-1 dui:peer-data-active/menu-button:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const [width] = React.useState(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  })

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("dui:flex dui:h-8 dui:items-center dui:gap-2 dui:rounded-md dui:px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="dui:size-4 dui:rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="dui:h-4 dui:max-w-(--skeleton-width) dui:flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "dui:mx-3.5 dui:flex dui:min-w-0 dui:translate-x-px rtl:dui:-translate-x-px dui:flex-col dui:gap-1 dui:border-s dui:border-sidebar-border dui:px-2.5 dui:py-0.5 dui:group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("dui:group/menu-sub-item dui:relative", className)}
      {...props}
    />
  )
}

const SidebarMenuSubButton = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentProps<"a"> & {
    asChild?: boolean
    size?: "sm" | "md"
    isActive?: boolean
  }
>(function SidebarMenuSubButton({ asChild = false, size = "md", isActive = false, className, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "a"

  return (
    <Comp
      ref={ref as never}
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "dui:flex dui:h-7 dui:min-w-0 dui:-translate-x-px rtl:dui:translate-x-px dui:items-center dui:gap-2 dui:overflow-hidden dui:rounded-md dui:px-2 dui:text-sidebar-foreground dui:ring-sidebar-ring dui:outline-hidden dui:group-data-[collapsible=icon]:hidden dui:hover:bg-sidebar-accent dui:hover:text-sidebar-accent-foreground dui:focus-visible:ring-2 dui:active:bg-sidebar-accent dui:active:text-sidebar-accent-foreground dui:disabled:pointer-events-none dui:disabled:opacity-50 dui:aria-disabled:pointer-events-none dui:aria-disabled:opacity-50 dui:data-[size=md]:text-xs dui:data-[size=sm]:text-xs dui:data-active:bg-sidebar-accent dui:data-active:text-sidebar-accent-foreground dui:[&>span:last-child]:truncate dui:[&>svg]:size-4 dui:[&>svg]:shrink-0 dui:[&>svg]:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    />
  )
})
SidebarMenuSubButton.displayName = "SidebarMenuSubButton"

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
