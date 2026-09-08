import * as React from "react"

import { cn } from "../../lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "dui:group/card dui:flex dui:flex-col dui:gap-(--card-spacing) dui:overflow-hidden dui:rounded-lg dui:bg-card dui:py-(--card-spacing) dui:text-xs/relaxed dui:text-card-foreground dui:ring-1 dui:ring-foreground/10 dui:[--card-spacing:--spacing(4)] dui:has-[>img:first-child]:pt-0 dui:data-[size=sm]:[--card-spacing:--spacing(3)] dui:*:[img:first-child]:rounded-t-lg dui:*:[img:last-child]:rounded-b-lg",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "dui:group/card-header dui:@container/card-header dui:grid dui:auto-rows-min dui:items-start dui:gap-1 dui:rounded-t-lg dui:px-(--card-spacing) dui:has-data-[slot=card-action]:grid-cols-[1fr_auto] dui:has-data-[slot=card-description]:grid-rows-[auto_auto] dui:[.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("dui:font-heading dui:text-sm dui:font-medium", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("dui:text-xs/relaxed dui:text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "dui:col-start-2 dui:row-span-2 dui:row-start-1 dui:self-start dui:justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("dui:px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "dui:flex dui:items-center dui:rounded-b-lg dui:px-(--card-spacing) dui:[.border-t]:pt-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
