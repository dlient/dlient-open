import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "dui:shrink-0 dui:bg-border dui:data-horizontal:h-px dui:data-horizontal:w-full dui:data-vertical:w-px dui:data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
