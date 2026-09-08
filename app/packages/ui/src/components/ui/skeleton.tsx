import { cn } from "../../lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("dui:animate-pulse dui:rounded-md dui:bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
