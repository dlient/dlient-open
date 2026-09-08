import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("dui:flex dui:min-w-0 dui:flex-col dui:gap-2", className)}
      {...props}
    />
  )
}

const bubbleVariants = cva(
  "dui:group/bubble dui:relative dui:flex dui:w-fit dui:max-w-[80%] dui:min-w-0 dui:flex-col dui:gap-1 dui:group-data-[align=end]/message:self-end dui:data-[align=end]:self-end dui:data-[variant=ghost]:max-w-full",
  {
    variants: {
      variant: {
        default:
          "dui:*:data-[slot=bubble-content]:bg-primary dui:*:data-[slot=bubble-content]:text-primary-foreground dui:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/80",
        secondary:
          "dui:*:data-[slot=bubble-content]:bg-secondary dui:*:data-[slot=bubble-content]:text-secondary-foreground dui:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        muted:
          "dui:*:data-[slot=bubble-content]:bg-muted dui:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]",
        tinted:
          "dui:*:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.93_calc(c*0.4)_h)] dui:*:data-[slot=bubble-content]:text-foreground dui:dark:*:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.3_calc(c*0.4)_h)] dui:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.88_calc(c*0.5)_h)] dui:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.35_calc(c*0.5)_h)]",
        outline:
          "dui:*:data-[slot=bubble-content]:border-border dui:*:data-[slot=bubble-content]:bg-background dui:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted dui:[&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dui:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-input/30",
        ghost:
          "dui:border-none dui:*:data-[slot=bubble-content]:rounded-none dui:*:data-[slot=bubble-content]:bg-transparent dui:*:data-[slot=bubble-content]:p-0 dui:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted dui:[&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dui:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/50",
        destructive:
          "dui:*:data-[slot=bubble-content]:bg-destructive/10 dui:*:data-[slot=bubble-content]:text-destructive dui:dark:*:data-[slot=bubble-content]:bg-destructive/20 dui:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 dui:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end"
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  )
}

const BubbleContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div"> & { asChild?: boolean }>(
  function BubbleContent({ asChild = false, className, ...props }, ref) {
    const Comp = asChild ? Slot.Root : "div"

    return (
      <Comp
        ref={ref as never}
        data-slot="bubble-content"
        className={cn(
          "dui:w-fit dui:max-w-full dui:min-w-0 dui:overflow-hidden dui:rounded-lg dui:border dui:border-transparent dui:px-2.5 dui:py-1.5 dui:text-xs/relaxed dui:wrap-break-word dui:group-data-[align=end]/bubble:self-end dui:[button]:text-start dui:[button,a]:transition-colors dui:[button,a]:outline-none dui:[button,a]:focus-visible:border-ring dui:[button,a]:focus-visible:ring-2 dui:[button,a]:focus-visible:ring-ring/30",
          className
        )}
        {...props}
      />
    )
  }
)
BubbleContent.displayName = "BubbleContent"

const bubbleReactionsVariants = cva(
  "dui:absolute dui:z-10 dui:flex dui:w-fit dui:shrink-0 dui:items-center dui:justify-center dui:gap-1 dui:rounded-full dui:bg-muted dui:px-1.5 dui:py-0.5 dui:text-xs dui:ring-2 dui:ring-card dui:has-[button]:p-0",
  {
    variants: {
      side: {
        top: "dui:top-0 dui:-translate-y-3/4",
        bottom: "dui:bottom-0 dui:translate-y-3/4",
      },
      align: {
        start: "dui:start-3",
        end: "dui:end-3",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  }
)

function BubbleReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end"
  side?: "top" | "bottom"
}) {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      className={cn(bubbleReactionsVariants({ side, align }), className)}
      {...props}
    />
  )
}

export { BubbleGroup, Bubble, BubbleContent, BubbleReactions }
