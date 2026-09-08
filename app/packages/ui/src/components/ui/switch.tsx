"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "dui:peer dui:group/switch dui:relative dui:inline-flex dui:cursor-pointer dui:shrink-0 dui:items-center dui:rounded-full dui:border dui:border-transparent dui:transition-all dui:outline-none dui:group-has-[:focus-visible]/field-label:border-transparent dui:group-has-[:focus-visible]/field-label:ring-0 dui:after:absolute dui:after:-inset-x-3 dui:after:-inset-y-2 dui:focus-visible:border-ring dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:aria-invalid:border-destructive dui:aria-invalid:ring-2 dui:aria-invalid:ring-destructive/20 dui:data-[size=default]:h-[16.6px] dui:data-[size=default]:w-[28px] dui:data-[size=sm]:h-[14px] dui:data-[size=sm]:w-[24px] dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40 dui:data-checked:bg-primary dui:data-unchecked:bg-input dui:dark:data-unchecked:bg-input/80 dui:data-disabled:cursor-not-allowed dui:data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="dui:pointer-events-none dui:block dui:rounded-full dui:bg-background dui:ring-0 dui:transition-transform dui:group-data-[size=default]/switch:size-3.5 dui:group-data-[size=sm]/switch:size-3 dui:group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] rtl:dui:group-data-[size=default]/switch:data-checked:-translate-x-[calc(100%-2px)] dui:group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] rtl:dui:group-data-[size=sm]/switch:data-checked:-translate-x-[calc(100%-2px)] dui:dark:data-checked:bg-primary-foreground dui:group-data-[size=default]/switch:data-unchecked:translate-x-0 rtl:dui:group-data-[size=default]/switch:data-unchecked:-translate-x-0 dui:group-data-[size=sm]/switch:data-unchecked:translate-x-0 rtl:dui:group-data-[size=sm]/switch:data-unchecked:-translate-x-0 dui:dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
