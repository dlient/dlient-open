import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "../../lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "./input-group"
import { SearchIcon, CheckIcon } from "lucide-react"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "dui:flex dui:size-full dui:flex-col dui:overflow-hidden dui:rounded-xl dui:bg-popover dui:p-1 dui:text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="dui:sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "dui:top-1/3 dui:translate-y-0 dui:overflow-hidden dui:rounded-xl! dui:p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="dui:p-1 dui:pb-0">
      <InputGroup className="dui:h-8! dui:bg-input/20 dui:dark:bg-input/30">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "dui:w-full dui:text-xs/relaxed dui:outline-hidden dui:disabled:cursor-not-allowed dui:disabled:opacity-50",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="dui:size-3.5 dui:shrink-0 dui:opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "dui:no-scrollbar dui:max-h-72 dui:scroll-py-1 dui:overflow-x-hidden dui:overflow-y-auto dui:outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("dui:py-6 dui:text-center dui:text-xs/relaxed", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "dui:overflow-hidden dui:p-1 dui:text-foreground dui:**:[[cmdk-group-heading]]:px-2.5 dui:**:[[cmdk-group-heading]]:py-1.5 dui:**:[[cmdk-group-heading]]:text-xs dui:**:[[cmdk-group-heading]]:font-medium dui:**:[[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("dui:-mx-1 dui:my-1 dui:h-px dui:bg-border/50", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "dui:group/command-item dui:relative dui:flex dui:min-h-7 dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2.5 dui:py-1.5 dui:text-xs/relaxed dui:outline-hidden dui:select-none dui:in-data-[slot=dialog-content]:rounded-md dui:data-[disabled=true]:pointer-events-none dui:data-[disabled=true]:opacity-50 dui:data-selected:bg-muted dui:data-selected:text-foreground dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5 dui:data-selected:*:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="dui:ms-auto dui:opacity-0 dui:group-has-data-[slot=command-shortcut]/command-item:hidden dui:group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "dui:ms-auto dui:text-[0.625rem] dui:tracking-widest dui:text-muted-foreground dui:group-data-selected/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
