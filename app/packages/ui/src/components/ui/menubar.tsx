"use client"

import * as React from "react"
import { Menubar as MenubarPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { CheckIcon, ChevronRightIcon } from "lucide-react"

function Menubar({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn("dui:flex dui:h-9 dui:items-center dui:rounded-lg dui:border dui:p-1", className)}
      {...props}
    />
  )
}

function MenubarMenu({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />
}

function MenubarGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />
}

function MenubarPortal({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  const container = usePluginPortalContainer()
  return <MenubarPrimitive.Portal data-slot="menubar-portal" container={container} {...props} />
}

function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return (
    <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />
  )
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "dui:flex dui:items-center dui:rounded-[calc(var(--radius-md)-2px)] dui:px-2 dui:py-[calc(--spacing(0.85))] dui:text-xs/relaxed dui:font-medium dui:outline-hidden dui:select-none dui:hover:bg-muted dui:aria-expanded:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function MenubarContent({
  className,
  align = "start",
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPortal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn("dui: dui: dui:z-50 dui:min-w-32 dui:origin-(--radix-menubar-content-transform-origin) dui:overflow-hidden dui:rounded-lg dui:bg-popover dui:p-1 dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95", className )}
        {...props}
      />
    </MenubarPortal>
  )
}

function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "dui:group/menubar-item dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs/relaxed dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:not-data-[variant=destructive]:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-[variant=destructive]:text-destructive dui:data-[variant=destructive]:focus:bg-destructive/10 dui:data-[variant=destructive]:focus:text-destructive dui:dark:data-[variant=destructive]:focus:bg-destructive/20 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5 dui:data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      {...props}
    />
  )
}

function MenubarCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      data-inset={inset}
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:py-1.5 dui:pe-2 dui:ps-7.5 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-disabled:pointer-events-none dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="dui:pointer-events-none dui:absolute dui:start-2 dui:flex dui:size-4 dui:items-center dui:justify-center dui:[&_svg:not([class*=size-])]:size-4">
        <MenubarPrimitive.ItemIndicator>
          <CheckIcon
          />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  )
}

function MenubarRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      data-inset={inset}
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:py-1.5 dui:pe-2 dui:ps-7.5 dui:text-xs dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      <span className="dui:pointer-events-none dui:absolute dui:start-2 dui:flex dui:size-4 dui:items-center dui:justify-center dui:[&_svg:not([class*=size-])]:size-4">
        <MenubarPrimitive.ItemIndicator>
          <CheckIcon
          />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  )
}

function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      data-inset={inset}
      className={cn(
        "dui:px-2 dui:py-1.5 dui:text-xs dui:text-muted-foreground dui:data-inset:ps-7.5",
        className
      )}
      {...props}
    />
  )
}

function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn("dui:-mx-1 dui:my-1 dui:h-px dui:bg-border/50", className)}
      {...props}
    />
  )
}

function MenubarShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        "dui:ms-auto dui:text-[0.625rem] dui:tracking-widest dui:text-muted-foreground dui:group-focus/menubar-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function MenubarSub({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />
}

function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      className={cn(
        "dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs dui:outline-none dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:not-data-[variant=destructive]:focus:**:text-accent-foreground dui:data-inset:ps-7.5 dui:data-open:bg-accent dui:data-open:text-accent-foreground dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="dui:ms-auto dui:size-4" />
    </MenubarPrimitive.SubTrigger>
  )
}

function MenubarSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPrimitive.SubContent
      data-slot="menubar-sub-content"
      className={cn("dui: dui: dui:z-50 dui:min-w-32 dui:origin-(--radix-menubar-content-transform-origin) dui:overflow-hidden dui:rounded-lg dui:bg-popover dui:p-1 dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95", className )}
      {...props}
    />
  )
}

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
}
