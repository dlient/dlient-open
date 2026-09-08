"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("dui:scroll-my-1 dui:p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "dui:cursor-pointer dui:flex dui:w-fit dui:items-center dui:justify-between dui:gap-1.5 dui:rounded-md dui:border dui:border-input dui:bg-input/20 dui:px-2 dui:py-1.5 dui:text-xs/relaxed dui:whitespace-nowrap dui:transition-colors dui:outline-none dui:focus-visible:border-ring dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:disabled:cursor-not-allowed dui:disabled:opacity-50 dui:aria-invalid:border-destructive dui:aria-invalid:ring-2 dui:aria-invalid:ring-destructive/20 dui:data-placeholder:text-muted-foreground dui:data-[size=default]:h-7 dui:data-[size=sm]:h-6 dui:*:data-[slot=select-value]:line-clamp-1 dui:*:data-[slot=select-value]:flex dui:*:data-[slot=select-value]:items-center dui:*:data-[slot=select-value]:gap-1.5 dui:dark:bg-input/30 dui:dark:hover:bg-input/50 dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="dui:pointer-events-none dui:size-3.5 dui:text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const container = usePluginPortalContainer()
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        className={cn("dui: dui: dui:relative dui:z-50 dui:max-h-(--radix-select-content-available-height) dui:min-w-32 dui:origin-(--radix-select-content-transform-origin) dui:overflow-x-hidden dui:overflow-y-auto dui:rounded-lg dui:bg-popover dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[align-trigger=true]:animate-none dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95", position ==="popper"&&"dui:data-[side=bottom]:translate-y-1 dui:data-[side=left]:-translate-x-1 rtl:dui:data-[side=left]:translate-x-1 dui:data-[side=right]:translate-x-1 rtl:dui:data-[side=right]:-translate-x-1 dui:data-[side=top]:-translate-y-1", className )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "dui:data-[position=popper]:h-(--radix-select-trigger-height) dui:data-[position=popper]:w-full dui:data-[position=popper]:min-w-(--radix-select-trigger-width)",
            position === "popper" && "dui:"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("dui:px-2 dui:py-1.5 dui:text-xs dui:text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:w-full dui:cursor-pointer dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs/relaxed dui:outline-hidden dui:select-none dui:focus:bg-accent dui:focus:text-accent-foreground dui:not-data-[variant=destructive]:focus:**:text-accent-foreground dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5 dui:*:[span]:last:flex dui:*:[span]:last:items-center dui:*:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="dui:pointer-events-none dui:absolute dui:end-2 dui:flex dui:items-center dui:justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="dui:pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "dui:pointer-events-none dui:-mx-1 dui:my-1 dui:h-px dui:bg-border/50",
        className
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "dui:z-10 dui:flex dui:cursor-default dui:items-center dui:justify-center dui:bg-popover dui:py-1 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "dui:z-10 dui:flex dui:cursor-default dui:items-center dui:justify-center dui:bg-popover dui:py-1 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
