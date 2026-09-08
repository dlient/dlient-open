import * as React from "react"

import { cn } from "../../lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "dui:h-7 dui:w-full dui:min-w-0 dui:rounded-md dui:border dui:border-input dui:bg-input/20 dui:px-2 dui:py-0.5 dui:text-sm dui:transition-colors dui:outline-none dui:file:inline-flex dui:file:h-6 dui:file:border-0 dui:file:bg-transparent dui:file:text-xs/relaxed dui:file:font-medium dui:file:text-foreground dui:placeholder:text-muted-foreground dui:focus-visible:border-ring dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:disabled:pointer-events-none dui:disabled:cursor-not-allowed dui:disabled:opacity-50 dui:aria-invalid:border-destructive dui:aria-invalid:ring-2 dui:aria-invalid:ring-destructive/20 dui:md:text-xs/relaxed dui:dark:bg-input/30 dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
// 兼容类型（旧 API 面）
export type InputProps = React.ComponentProps<"input">
