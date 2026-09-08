"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { toggleVariants } from "./toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "dui:group/toggle-group dui:flex dui:w-fit dui:flex-row dui:items-center dui:gap-[--spacing(var(--gap))] dui:rounded-md dui:data-[size=sm]:rounded-[min(var(--radius-md),8px)] dui:data-vertical:flex-col dui:data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "dui:shrink-0 dui:group-data-[spacing=0]/toggle-group:rounded-none dui:group-data-[spacing=0]/toggle-group:px-2 dui:focus:z-10 dui:focus-visible:z-10 dui:group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pe-1.5 dui:group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:ps-1.5 dui:group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-s-md dui:group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-md dui:group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-e-md dui:group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-md dui:group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-s-0 dui:group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 dui:group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-s dui:group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
