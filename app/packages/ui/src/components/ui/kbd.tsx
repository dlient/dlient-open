import { cn } from "../../lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "dui:pointer-events-none dui:inline-flex dui:h-5 dui:w-fit dui:min-w-5 dui:items-center dui:justify-center dui:gap-1 dui:rounded-xs dui:bg-muted dui:px-1 dui:font-sans dui:text-[0.625rem] dui:font-medium dui:text-muted-foreground dui:select-none dui:in-data-[slot=tooltip-content]:bg-background/20 dui:in-data-[slot=tooltip-content]:text-background dui:dark:in-data-[slot=tooltip-content]:bg-background/10 dui:[&_svg:not([class*=size-])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("dui:inline-flex dui:items-center dui:gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
