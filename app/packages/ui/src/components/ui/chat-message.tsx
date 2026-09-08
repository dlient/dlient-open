import * as React from "react"

import { cn } from "../../lib/utils"

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("dui:flex dui:min-w-0 dui:flex-col dui:gap-1.5", className)}
      {...props}
    />
  )
}

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "dui:group/message dui:relative dui:flex dui:w-full dui:min-w-0 dui:gap-1.5 dui:text-xs/relaxed dui:data-[align=end]:flex-row-reverse",
        className
      )}
      {...props}
    />
  )
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "dui:flex dui:w-fit dui:min-w-8 dui:shrink-0 dui:items-center dui:justify-center dui:self-end dui:overflow-hidden dui:rounded-full dui:bg-muted dui:group-has-data-[slot=message-footer]/message:-translate-y-8",
        className
      )}
      {...props}
    />
  )
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "dui:flex dui:w-full dui:min-w-0 dui:flex-col dui:gap-2 dui:wrap-break-word dui:group-data-[align=end]/message:*:data-slot:self-end",
        className
      )}
      {...props}
    />
  )
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "dui:flex dui:max-w-full dui:min-w-0 dui:items-center dui:px-2.5 dui:text-[0.625rem] dui:font-medium dui:text-muted-foreground dui:group-has-data-[variant=ghost]/message:px-0",
        className
      )}
      {...props}
    />
  )
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "dui:flex dui:max-w-full dui:min-w-0 dui:items-center dui:px-2.5 dui:text-[0.625rem] dui:font-medium dui:text-muted-foreground dui:group-has-data-[variant=ghost]/message:px-0 dui:group-data-[align=end]/message:justify-end",
        className
      )}
      {...props}
    />
  )
}

export {
  MessageGroup,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
}
