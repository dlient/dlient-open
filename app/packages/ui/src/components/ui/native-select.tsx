import * as React from "react"

import { cn } from "../../lib/utils"
import { ChevronDownIcon } from "lucide-react"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "dui:group/native-select dui:relative dui:w-fit dui:has-[select:disabled]:opacity-50",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="dui:h-7 dui:w-full dui:min-w-0 dui:appearance-none dui:rounded-md dui:border dui:border-input dui:bg-input/20 dui:py-0.5 dui:pe-6 dui:ps-2 dui:text-xs/relaxed dui:transition-colors dui:outline-none dui:select-none dui:selection:bg-primary dui:selection:text-primary-foreground dui:placeholder:text-muted-foreground dui:focus-visible:border-ring dui:focus-visible:ring-2 dui:focus-visible:ring-ring/30 dui:disabled:pointer-events-none dui:disabled:cursor-not-allowed dui:aria-invalid:border-destructive dui:aria-invalid:ring-2 dui:aria-invalid:ring-destructive/20 dui:data-[size=sm]:h-6 dui:data-[size=sm]:text-[0.625rem] dui:dark:bg-input/30 dui:dark:hover:bg-input/50 dui:dark:aria-invalid:border-destructive/50 dui:dark:aria-invalid:ring-destructive/40"
        {...props}
      />
      <ChevronDownIcon className="dui:pointer-events-none dui:absolute dui:top-1/2 dui:end-1.5 dui:size-3.5 dui:-translate-y-1/2 dui:text-muted-foreground dui:select-none dui:group-data-[size=sm]/native-select:size-3 dui:group-data-[size=sm]/native-select:-translate-y-[calc(--spacing(1.25))]" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("dui:bg-[Canvas] dui:text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("dui:bg-[Canvas] dui:text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
