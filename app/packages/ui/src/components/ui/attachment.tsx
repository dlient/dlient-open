import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"
import { Button } from "./button"

const attachmentVariants = cva(
  "dui:group/attachment dui:relative dui:flex dui:w-fit dui:max-w-full dui:min-w-0 dui:shrink-0 dui:flex-wrap dui:rounded-lg dui:border dui:bg-card dui:text-card-foreground dui:transition-colors dui:focus-within:ring-1 dui:focus-within:ring-ring/30 dui:has-[>a,>button]:hover:bg-muted/50 dui:data-[state=error]:border-destructive/30 dui:data-[state=idle]:border-dashed",
  {
    variants: {
      size: {
        default:
          "dui:gap-2 dui:text-xs dui:has-data-[slot=attachment-content]:px-2 dui:has-data-[slot=attachment-content]:py-1.5 dui:has-data-[slot=attachment-media]:p-1.5",
        sm: "dui:gap-2.5 dui:text-xs dui:has-data-[slot=attachment-content]:px-1.5 dui:has-data-[slot=attachment-content]:py-1 dui:has-data-[slot=attachment-media]:p-1",
        xs: "dui:gap-1.5 dui:rounded-md dui:text-xs dui:has-data-[slot=attachment-content]:px-1.5 dui:has-data-[slot=attachment-content]:py-1 dui:has-data-[slot=attachment-media]:p-1",
      },
      orientation: {
        horizontal: "dui:min-w-40 dui:items-center",
        vertical: "dui:w-24 dui:flex-col dui:has-data-[slot=attachment-content]:w-30",
      },
    },
  }
)

function Attachment({
  className,
  state = "done",
  size = "default",
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof attachmentVariants> & {
    state?: "idle" | "uploading" | "processing" | "error" | "done"
  }) {
  return (
    <div
      data-slot="attachment"
      data-state={state}
      data-size={size}
      data-orientation={orientation}
      className={cn(attachmentVariants({ size, orientation }), className)}
      {...props}
    />
  )
}

const attachmentMediaVariants = cva(
  "dui:relative dui:flex dui:aspect-square dui:w-10 dui:shrink-0 dui:items-center dui:justify-center dui:overflow-hidden dui:rounded-md dui:bg-muted dui:text-foreground dui:group-data-[orientation=vertical]/attachment:w-full dui:group-data-[size=sm]/attachment:w-8 dui:group-data-[size=xs]/attachment:w-7 dui:group-data-[size=xs]/attachment:rounded-sm dui:group-data-[state=error]/attachment:bg-destructive/10 dui:group-data-[state=error]/attachment:text-destructive dui:group-data-[orientation=vertical]/attachment:*:data-[slot=spinner]:size-6! dui:[&_svg]:pointer-events-none dui:[&_svg:not([class*=size-])]:size-4 dui:group-data-[orientation=vertical]/attachment:[&_svg:not([class*=size-])]:size-6 dui:group-data-[size=xs]/attachment:[&_svg:not([class*=size-])]:size-3.5",
  {
    variants: {
      variant: {
        icon: "dui:",
        image:
          "dui:opacity-60 dui:group-data-[state=done]/attachment:opacity-100 dui:group-data-[state=idle]/attachment:opacity-100 dui:*:[img]:aspect-square dui:*:[img]:w-full dui:*:[img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "icon",
    },
  }
)

function AttachmentMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(attachmentMediaVariants({ variant }), className)}
      {...props}
    />
  )
}

function AttachmentContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn(
        "dui:max-w-full dui:min-w-0 dui:flex-1 dui:leading-tight dui:group-data-[orientation=vertical]/attachment:px-1",
        className
      )}
      {...props}
    />
  )
}

function AttachmentTitle({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-title"
      className={cn(
        "dui:block dui:max-w-full dui:min-w-0 dui:truncate dui:font-medium dui:group-data-[state=processing]/attachment:shimmer dui:group-data-[state=uploading]/attachment:shimmer",
        className
      )}
      {...props}
    />
  )
}

function AttachmentDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn(
        "dui:mt-0.5 dui:block dui:min-w-0 dui:truncate dui:text-xs dui:text-muted-foreground dui:group-data-[state=error]/attachment:text-destructive/80",
        "dui:max-w-full",
        className
      )}
      {...props}
    />
  )
}

function AttachmentActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn(
        "dui:relative dui:z-20 dui:flex dui:shrink-0 dui:items-center dui:group-data-[orientation=vertical]/attachment:absolute dui:group-data-[orientation=vertical]/attachment:top-3 dui:group-data-[orientation=vertical]/attachment:end-3 dui:group-data-[orientation=vertical]/attachment:gap-1",
        className
      )}
      {...props}
    />
  )
}

function AttachmentAction({
  className,
  variant,
  size = "icon-xs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      variant={variant ?? "ghost"}
      size={size}
      className={cn(className)}
      {...props}
    />
  )
}

const AttachmentTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean
  }
>(function AttachmentTrigger({ className, asChild = false, type, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref as never}
      data-slot="attachment-trigger"
      type={asChild ? undefined : (type ?? "button")}
      className={cn("dui:absolute dui:inset-0 dui:z-10 dui:outline-none", className)}
      {...props}
    />
  )
})
AttachmentTrigger.displayName = "AttachmentTrigger"

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn(
        "dui:flex dui:min-w-0 dui:scroll-fade-x dui:snap-x dui:snap-mandatory dui:scroll-px-1 dui:scrollbar-none dui:gap-3 dui:overflow-x-auto dui:overscroll-x-contain dui:py-1 dui:*:data-[slot=attachment]:flex-none dui:*:data-[slot=attachment]:snap-start",
        className
      )}
      {...props}
    />
  )
}

export {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
}
