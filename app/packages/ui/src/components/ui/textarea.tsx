import * as React from "react"

import { cn } from "../../lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "dui:flex dui:field-sizing-content dui:min-h-16 dui:w-full dui:resize-none dui:rounded-md dui:border dui:border-input dui:bg-input/20 dui:px-2 dui:py-2 dui:text-sm dui:transition-colors dui:outline-none dui:placeholder:text-muted-foreground dui:focus-visible:border-ring dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:disabled:cursor-not-allowed dui:disabled:opacity-50 dui:aria-invalid:border-destructive dui:aria-invalid:ring-2 dui:aria-invalid:ring-destructive/20 dui:md:text-xs/relaxed dui:dark:bg-input/30 dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
// 兼容类型（旧 API 面）
export type TextareaProps = React.ComponentProps<"textarea">
