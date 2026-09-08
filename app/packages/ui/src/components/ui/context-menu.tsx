import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("dui:select-none", className)}
      {...props}
    />
  )
}

function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  )
}

function ContextMenuPortal({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  const container = usePluginPortalContainer()
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" container={container} {...props} />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  const container = usePluginPortalContainer()
  return (
    <ContextMenuPrimitive.Portal container={container}>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn("dui: dui: dui:z-50 dui:max-h-(--radix-context-menu-content-available-height) dui:min-w-32 dui:origin-(--radix-context-menu-content-transform-origin) dui:overflow-x-hidden dui:overflow-y-auto dui:rounded-lg dui:bg-popover dui:p-1 dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95", className )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "dui:group/context-menu-item dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs/relaxed dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:not-data-[variant=destructive]:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-[variant=destructive]:text-destructive dui:data-[variant=destructive]:focus:bg-destructive/10 dui:data-[variant=destructive]:focus:text-destructive dui:dark:data-[variant=destructive]:focus:bg-destructive/20 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5 dui:data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:not-data-[variant=destructive]:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-open:bg-accent dui:data-open:text-accent-foreground dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="dui:ms-auto" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn("dui: dui: dui:z-50 dui:min-w-32 dui:origin-(--radix-context-menu-content-transform-origin) dui:overflow-hidden dui:rounded-lg dui:bg-popover dui:p-1 dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95", className )}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:py-1.5 dui:pe-8 dui:ps-2 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="dui:pointer-events-none dui:absolute dui:end-2 dui:flex dui:items-center dui:justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:py-1.5 dui:pe-8 dui:ps-2 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      <span className="dui:pointer-events-none dui:absolute dui:end-2 dui:flex dui:items-center dui:justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "dui:px-2 dui:py-1.5 dui:text-xs dui:text-muted-foreground dui:data-inset:ps-7.5",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("dui:-mx-1 dui:my-1 dui:h-px dui:bg-border/50", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "dui:ms-auto dui:text-[0.625rem] dui:tracking-widest dui:text-muted-foreground dui:group-focus/context-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
