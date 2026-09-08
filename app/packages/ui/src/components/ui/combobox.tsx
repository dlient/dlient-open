"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { Button } from "./button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group"
import { ChevronDownIcon, XIcon, CheckIcon } from "lucide-react"

const Combobox = ComboboxPrimitive.Root

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn("dui:[&_svg:not([class*=size-])]:size-3.5", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="dui:pointer-events-none dui:size-3.5 dui:text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      render={<InputGroupButton variant="ghost" size="icon-xs" />}
      className={cn(className)}
      {...props}
    >
      <XIcon className="dui:pointer-events-none" />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean
  showClear?: boolean
}) {
  return (
    <InputGroup className={cn("dui:w-auto", className)}>
      <ComboboxPrimitive.Input
        render={<InputGroupInput disabled={disabled} />}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            asChild
            data-slot="input-group-button"
            className="dui:group-has-data-[slot=combobox-clear]/input-group:hidden dui:data-pressed:bg-transparent"
            disabled={disabled}
          >
            <ComboboxTrigger />
          </InputGroupButton>
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  )
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  const container = usePluginPortalContainer()
  return (
    <ComboboxPrimitive.Portal container={container}>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="dui:isolate dui:z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          className={cn("dui: dui: dui:group/combobox-content dui:relative dui:max-h-(--available-height) dui:w-(--anchor-width) dui:max-w-(--available-width) dui:min-w-[calc(var(--anchor-width)+--spacing(7))] dui:origin-(--transform-origin) dui:overflow-hidden dui:rounded-lg dui:bg-popover dui:text-popover-foreground dui:shadow-md dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:data-[chips=true]:min-w-(--anchor-width) dui:data-[side=bottom]:slide-in-from-top-2 dui:data-[side=inline-end]:slide-in-from-start-2 dui:data-[side=inline-start]:slide-in-from-end-2 dui:data-[side=left]:slide-in-from-right-2 dui:data-[side=right]:slide-in-from-left-2 dui:data-[side=top]:slide-in-from-bottom-2 dui:*:data-[slot=input-group]:m-1 dui:*:data-[slot=input-group]:mb-0 dui:*:data-[slot=input-group]:h-7 dui:*:data-[slot=input-group]:border-none dui:*:data-[slot=input-group]:bg-input/20 dui:*:data-[slot=input-group]:shadow-none dui:dark:bg-popover dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95", className )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "dui:no-scrollbar dui:max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] dui:scroll-py-1 dui:overflow-y-auto dui:overscroll-contain dui:p-1 dui:data-empty:p-0",
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "dui:relative dui:flex dui:min-h-7 dui:w-full dui:cursor-default dui:items-center dui:gap-2 dui:rounded-md dui:px-2 dui:py-1 dui:text-xs/relaxed dui:outline-hidden dui:select-none dui:data-highlighted:bg-accent dui:data-highlighted:text-accent-foreground dui:not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground dui:data-disabled:pointer-events-none dui:data-disabled:opacity-50 dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="dui:pointer-events-none dui:absolute dui:end-2 dui:flex dui:items-center dui:justify-center" />
        }
      >
        <CheckIcon className="dui:pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn(className)}
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn("dui:px-2 dui:py-1.5 dui:text-xs dui:text-muted-foreground", className)}
      {...props}
    />
  )
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return (
    <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "dui:hidden dui:w-full dui:justify-center dui:py-2 dui:text-center dui:text-xs/relaxed dui:text-muted-foreground dui:group-data-empty/combobox-content:flex",
        className
      )}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("dui:-mx-1 dui:my-1 dui:h-px dui:bg-border/50", className)}
      {...props}
    />
  )
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "dui:flex dui:min-h-7 dui:flex-wrap dui:items-center dui:gap-1 dui:rounded-md dui:border dui:border-input dui:bg-input/20 dui:bg-clip-padding dui:px-2 dui:py-0.5 dui:text-xs/relaxed dui:transition-colors dui:focus-within:border-ring dui:focus-within:ring-2 dui:focus-within:ring-ring/30 dui:has-aria-invalid:border-destructive dui:has-aria-invalid:ring-2 dui:has-aria-invalid:ring-destructive/20 dui:has-data-[slot=combobox-chip]:px-1 dui:dark:bg-input/30 dui:dark:has-aria-invalid:border-destructive/50 dui:dark:has-aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        "dui:flex dui:h-[calc(--spacing(4.75))] dui:w-fit dui:items-center dui:justify-center dui:gap-1 dui:rounded-[calc(var(--radius-sm)-2px)] dui:bg-muted-foreground/10 dui:px-1.5 dui:text-xs/relaxed dui:font-medium dui:whitespace-nowrap dui:text-foreground dui:has-disabled:pointer-events-none dui:has-disabled:cursor-not-allowed dui:has-disabled:opacity-50 dui:has-data-[slot=combobox-chip-remove]:pe-0",
        className
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          render={<Button variant="ghost" size="icon-xs" />}
          className="dui:-ms-1 dui:opacity-50 dui:hover:opacity-100"
          data-slot="combobox-chip-remove"
        >
          <XIcon className="dui:pointer-events-none" />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn("dui:min-w-16 dui:flex-1 dui:outline-none", className)}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null)
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
}
