import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "dui:flex dui:items-center dui:gap-2 dui:text-xs/relaxed dui:leading-none dui:font-medium dui:select-none dui:group-data-[disabled=true]:pointer-events-none dui:group-data-[disabled=true]:opacity-50 dui:peer-disabled:cursor-not-allowed dui:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
