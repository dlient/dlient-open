import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"
import { Separator } from "./separator"

const buttonGroupVariants = cva(
  "dui:group/button-group dui:flex dui:w-fit dui:items-stretch dui:*:focus-visible:relative dui:*:focus-visible:z-10 dui:has-[>[data-slot=button-group]]:gap-2 dui:has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-e-md dui:[&>[data-slot=select-trigger]:not([class*=w-])]:w-fit dui:[&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "dui:[&>*:not(:first-child)]:rounded-s-none dui:[&>*:not(:first-child)]:border-s-0 dui:[&>*:not(:last-child)]:rounded-e-none dui:[&>[data-slot]:not(:has(~[data-slot]))]:rounded-e-md!",
        vertical:
          "dui:flex-col dui:[&>*:not(:first-child)]:rounded-t-none dui:[&>*:not(:first-child)]:border-t-0 dui:[&>*:not(:last-child)]:rounded-b-none dui:[&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-md!",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  }
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

const ButtonGroupText = React.forwardRef<HTMLDivElement, React.ComponentProps<"div"> & { asChild?: boolean }>(
  function ButtonGroupText({ className, asChild = false, ...props }, ref) {
    const Comp = asChild ? Slot.Root : "div"

    return (
      <Comp
        ref={ref as never}
        className={cn(
          "dui:flex dui:items-center dui:gap-2 dui:rounded-md dui:border dui:bg-muted dui:px-2.5 dui:text-xs/relaxed dui:font-medium dui:[&_svg]:pointer-events-none dui:[&_svg:not([class*=size-])]:size-4",
          className
        )}
        {...props}
      />
    )
  }
)
ButtonGroupText.displayName = "ButtonGroupText"

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "dui:relative dui:self-stretch dui:bg-input dui:data-horizontal:mx-px dui:data-horizontal:w-auto dui:data-vertical:my-px dui:data-vertical:h-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
}
