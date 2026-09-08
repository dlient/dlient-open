"use client"

import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { CheckIcon, ChevronRightIcon } from "lucide-react"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  const container = usePluginPortalContainer()
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" container={container} {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const container = usePluginPortalContainer()
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn("dui: dui: dui:z-50 dui:max-h-(--radix-dropdown-menu-content-available-height) dui:w-(--radix-dropdown-menu-trigger-width) dui:min-w-32 dui:origin-(--radix-dropdown-menu-content-transform-origin) dui:overflow-x-hidden dui:overflow-y-auto dui:rounded-lg dui:bg-popover dui:p-1 dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-[state=closed]:overflow-hidden dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95", className )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "dui:group/dropdown-menu-item dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs/relaxed dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:not-data-[variant=destructive]:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-[variant=destructive]:text-destructive dui:data-[variant=destructive]:focus:bg-destructive/10 dui:data-[variant=destructive]:focus:text-destructive dui:dark:data-[variant=destructive]:focus:bg-destructive/20 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5 dui:data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:py-1.5 dui:pe-8 dui:ps-2 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="dui:pointer-events-none dui:absolute dui:end-2 dui:flex dui:items-center dui:justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:py-1.5 dui:pe-8 dui:ps-2 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      <span
        className="dui:pointer-events-none dui:absolute dui:end-2 dui:flex dui:items-center dui:justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "dui:px-2 dui:py-1.5 dui:text-xs dui:text-muted-foreground dui:data-inset:ps-7.5",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("dui:-mx-1 dui:my-1 dui:h-px dui:bg-border/50", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "dui:ms-auto dui:text-[0.625rem] dui:tracking-widest dui:text-muted-foreground dui:group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:not-data-[variant=destructive]:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-open:bg-accent dui:data-open:text-accent-foreground dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="dui:ms-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn("dui: dui: dui:z-50 dui:min-w-32 dui:origin-(--radix-dropdown-menu-content-transform-origin) dui:overflow-hidden dui:rounded-lg dui:bg-popover dui:p-1 dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95", className )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
