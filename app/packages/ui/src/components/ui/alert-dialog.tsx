import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { usePluginPortalContainer } from "../../lib/plugin-portal"
import { Button } from "./button"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  const container = usePluginPortalContainer()
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" container={container} {...props} />
  )
}

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    data-slot="alert-dialog-overlay"
    className={cn(
      "dui:fixed dui:inset-0 dui:z-50 dui:bg-black/80 dui:duration-100 dui:supports-backdrop-filter:backdrop-blur-xs dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-closed:animate-out dui:data-closed:fade-out-0",
      className
    )}
    {...props}
  />
))
AlertDialogOverlay.displayName = "AlertDialogOverlay"

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "dui:group/alert-dialog-content dui:fixed dui:top-1/2 dui:start-1/2 dui:z-50 dui:grid dui:w-full dui:-translate-x-1/2 rtl:dui:translate-x-1/2 dui:-translate-y-1/2 dui:gap-3 dui:rounded-xl dui:bg-popover dui:p-4 dui:text-popover-foreground dui:ring-1 dui:ring-foreground/10 dui:duration-100 dui:outline-none dui:data-[size=default]:max-w-xs dui:data-[size=sm]:max-w-64 dui:data-[size=default]:sm:max-w-sm dui:data-open:animate-in dui:data-open:fade-in-0 dui:data-open:zoom-in-95 dui:data-closed:animate-out dui:data-closed:fade-out-0 dui:data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "dui:grid dui:grid-rows-[auto_1fr] dui:place-items-center dui:gap-1 dui:text-center dui:has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] dui:has-data-[slot=alert-dialog-media]:gap-x-4 dui:sm:group-data-[size=default]/alert-dialog-content:place-items-start dui:sm:group-data-[size=default]/alert-dialog-content:text-start dui:sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "dui:flex dui:flex-col-reverse dui:gap-2 dui:group-data-[size=sm]/alert-dialog-content:grid dui:group-data-[size=sm]/alert-dialog-content:grid-cols-2 dui:sm:flex-row dui:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "dui:mb-2 dui:inline-flex dui:size-8 dui:items-center dui:justify-center dui:rounded-md dui:bg-muted dui:sm:group-data-[size=default]/alert-dialog-content:row-span-2 dui:*:[svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "dui:font-heading dui:text-sm dui:font-medium dui:sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "dui:text-xs/relaxed dui:text-balance dui:text-muted-foreground dui:md:text-pretty dui:*:[a]:underline dui:*:[a]:underline-offset-3 dui:*:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
