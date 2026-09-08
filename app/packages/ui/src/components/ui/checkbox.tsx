import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "dui:cursor-pointer dui:peer dui:relative dui:flex dui:size-4 dui:shrink-0 dui:items-center dui:justify-center dui:rounded-[4px] dui:border dui:border-input dui:transition-shadow dui:outline-none dui:group-has-disabled/field:opacity-50 dui:group-has-[:focus-visible]/field-label:ring-0 dui:group-has-[:focus-visible]/field-label:not-data-checked:border-input dui:after:absolute dui:after:-inset-x-3 dui:after:-inset-y-2 dui:focus-visible:border-ring dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:disabled:cursor-not-allowed dui:disabled:opacity-50 dui:aria-invalid:border-destructive dui:aria-invalid:ring-2 dui:aria-invalid:ring-destructive/20 dui:aria-invalid:aria-checked:border-primary dui:dark:bg-input/30 dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40 dui:data-checked:border-primary dui:data-checked:bg-primary dui:data-checked:text-primary-foreground dui:group-has-[:focus-visible]/field-label:data-checked:border-primary dui:dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="dui:grid dui:place-content-center dui:text-current dui:transition-none dui:[&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
