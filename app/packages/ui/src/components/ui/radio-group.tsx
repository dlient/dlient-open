import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("dui:grid dui:w-full dui:gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "dui:cursor-pointer dui:group/radio-group-item dui:peer dui:relative dui:flex dui:aspect-square dui:size-4 dui:shrink-0 dui:rounded-full dui:border dui:border-input dui:outline-none dui:group-has-[:focus-visible]/field-label:ring-0 dui:group-has-[:focus-visible]/field-label:not-data-checked:border-input dui:after:absolute dui:after:-inset-x-3 dui:after:-inset-y-2 dui:focus-visible:border-ring dui:focus-visible:ring-3 dui:focus-visible:ring-ring/50 dui:disabled:cursor-not-allowed dui:disabled:opacity-50 dui:aria-invalid:border-destructive dui:aria-invalid:ring-3 dui:aria-invalid:ring-destructive/20 dui:aria-invalid:aria-checked:border-primary dui:dark:bg-input/30 dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40 dui:data-checked:border-primary dui:data-checked:bg-primary dui:data-checked:text-primary-foreground dui:group-has-[:focus-visible]/field-label:data-checked:border-primary dui:dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="dui:flex dui:size-4 dui:items-center dui:justify-center"
      >
        <span className="dui:absolute dui:top-1/2 dui:start-1/2 dui:size-2 dui:-translate-x-1/2 rtl:dui:translate-x-1/2 dui:-translate-y-1/2 dui:rounded-full dui:bg-primary-foreground" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
