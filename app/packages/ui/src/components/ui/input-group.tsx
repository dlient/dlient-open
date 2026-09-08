import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"
import { Button } from "./button"
import { Input } from "./input"
import { Textarea } from "./textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "dui:group/input-group dui:relative dui:flex dui:h-7 dui:w-full dui:min-w-0 dui:items-center dui:rounded-md dui:border dui:border-input dui:bg-input/20 dui:transition-colors dui:outline-none dui:in-data-[slot=combobox-content]:focus-within:border-inherit dui:in-data-[slot=combobox-content]:focus-within:ring-0 dui:has-data-[align=block-end]:rounded-md dui:has-data-[align=block-start]:rounded-md dui:has-[[data-slot=input-group-control]:focus-visible]:border-ring dui:has-[[data-slot=input-group-control]:focus-visible]:ring-2 dui:has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30 dui:has-[[data-slot][aria-invalid=true]]:border-destructive dui:has-[[data-slot][aria-invalid=true]]:ring-2 dui:has-[[data-slot][aria-invalid=true]]:ring-destructive/20 dui:has-[textarea]:rounded-md dui:has-[>[data-align=block-end]]:h-auto dui:has-[>[data-align=block-end]]:flex-col dui:has-[>[data-align=block-start]]:h-auto dui:has-[>[data-align=block-start]]:flex-col dui:has-[>textarea]:h-auto dui:dark:bg-input/30 dui:dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 dui:has-[>[data-align=block-end]]:[&>input]:pt-3 dui:has-[>[data-align=block-start]]:[&>input]:pb-3 dui:has-[>[data-align=inline-end]]:[&>input]:pe-1.5 dui:has-[>[data-align=inline-start]]:[&>input]:ps-1.5",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "dui:flex dui:h-auto dui:cursor-text dui:items-center dui:justify-center dui:gap-1 dui:py-2 dui:text-xs/relaxed dui:font-medium dui:text-muted-foreground dui:select-none dui:group-data-[disabled=true]/input-group:opacity-50 dui:**:data-[slot=kbd]:rounded-[calc(var(--radius-sm)-2px)] dui:**:data-[slot=kbd]:bg-muted-foreground/10 dui:**:data-[slot=kbd]:px-1 dui:**:data-[slot=kbd]:text-[0.625rem] dui:[&>svg:not([class*=size-])]:size-3.5",
  {
    variants: {
      align: {
        "inline-start":
          "dui:order-first dui:ps-2 dui:has-[>button]:ms-[-0.275rem] dui:has-[>kbd]:ms-[-0.275rem]",
        "inline-end":
          "dui:order-last dui:pe-2 dui:has-[>button]:me-[-0.275rem] dui:has-[>kbd]:me-[-0.275rem]",
        "block-start":
          "dui:order-first dui:w-full dui:justify-start dui:px-2 dui:pt-2 dui:group-has-[>input]/input-group:pt-2 dui:[.border-b]:pb-2",
        "block-end":
          "dui:order-last dui:w-full dui:justify-start dui:px-2 dui:pb-2 dui:group-has-[>input]/input-group:pb-2 dui:[.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "dui:flex dui:items-center dui:gap-2 dui:rounded-md dui:text-xs/relaxed dui:shadow-none",
  {
    variants: {
      size: {
        xs: "dui:h-5 dui:gap-1 dui:rounded-[calc(var(--radius-sm)-2px)] dui:px-1 dui:[&>svg:not([class*=size-])]:size-3",
        sm: "dui:gap-1",
        "icon-xs": "dui:size-6 dui:p-0 dui:has-[>svg]:p-0",
        "icon-sm": "dui:size-7 dui:p-0 dui:has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "dui:flex dui:items-center dui:gap-2 dui:text-xs/relaxed dui:text-muted-foreground dui:[&_svg]:pointer-events-none dui:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "dui:flex-1 dui:rounded-none dui:border-0 dui:bg-transparent dui:shadow-none dui:ring-0 dui:focus-visible:ring-0 dui:aria-invalid:ring-0 dui:dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "dui:flex-1 dui:resize-none dui:rounded-none dui:border-0 dui:bg-transparent dui:py-2 dui:shadow-none dui:ring-0 dui:focus-visible:ring-0 dui:aria-invalid:ring-0 dui:dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
