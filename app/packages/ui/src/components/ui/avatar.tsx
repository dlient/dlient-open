import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "dui:group/avatar dui:relative dui:flex dui:size-8 dui:shrink-0 dui:rounded-full dui:select-none dui:after:absolute dui:after:inset-0 dui:after:rounded-full dui:after:border dui:after:border-border dui:after:mix-blend-darken dui:data-[size=lg]:size-10 dui:data-[size=sm]:size-6 dui:dark:after:mix-blend-lighten",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "dui:aspect-square dui:size-full dui:rounded-full dui:object-cover",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "dui:flex dui:size-full dui:items-center dui:justify-center dui:rounded-full dui:bg-muted dui:text-sm dui:text-muted-foreground dui:group-data-[size=sm]/avatar:text-xs",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "dui:absolute dui:end-0 dui:bottom-0 dui:z-10 dui:inline-flex dui:items-center dui:justify-center dui:rounded-full dui:bg-primary dui:text-primary-foreground dui:bg-blend-color dui:ring-2 dui:ring-background dui:select-none",
        "dui:group-data-[size=sm]/avatar:size-2 dui:group-data-[size=sm]/avatar:[&>svg]:hidden",
        "dui:group-data-[size=default]/avatar:size-2.5 dui:group-data-[size=default]/avatar:[&>svg]:size-2",
        "dui:group-data-[size=lg]/avatar:size-3 dui:group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "dui:group/avatar-group dui:flex dui:-space-x-2 dui:*:data-[slot=avatar]:ring-2 dui:*:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "dui:relative dui:flex dui:size-8 dui:shrink-0 dui:items-center dui:justify-center dui:rounded-full dui:bg-muted dui:text-xs/relaxed dui:text-muted-foreground dui:ring-2 dui:ring-background dui:group-has-data-[size=lg]/avatar-group:size-10 dui:group-has-data-[size=sm]/avatar-group:size-6 dui:[&>svg]:size-4 dui:group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 dui:group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
