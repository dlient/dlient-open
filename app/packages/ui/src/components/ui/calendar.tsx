"use client"

import * as React from "react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker"

import { cn } from "../../lib/utils"
import { Button, buttonVariants } from "./button"
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "dui:group/calendar dui:bg-background dui:p-3 dui:[--cell-radius:var(--radius-md)] dui:[--cell-size:--spacing(6)] dui:in-data-[slot=card-content]:bg-transparent dui:in-data-[slot=popover-content]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("dui:w-fit", defaultClassNames.root),
        months: cn(
          "dui:relative dui:flex dui:flex-col dui:gap-4 dui:md:flex-row",
          defaultClassNames.months
        ),
        month: cn("dui:flex dui:w-full dui:flex-col dui:gap-4", defaultClassNames.month),
        nav: cn(
          "dui:absolute dui:inset-x-0 dui:top-0 dui:flex dui:w-full dui:items-center dui:justify-between dui:gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "dui:size-(--cell-size) dui:p-0 dui:select-none dui:aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "dui:size-(--cell-size) dui:p-0 dui:select-none dui:aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "dui:flex dui:h-(--cell-size) dui:w-full dui:items-center dui:justify-center dui:px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "dui:flex dui:h-(--cell-size) dui:w-full dui:items-center dui:justify-center dui:gap-1.5 dui:text-sm dui:font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "dui:relative dui:rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "dui:absolute dui:inset-0 dui:bg-popover dui:opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "dui:font-medium dui:select-none",
          captionLayout === "label"
            ? "dui:text-sm"
            : "dui:flex dui:items-center dui:gap-1 dui:rounded-(--cell-radius) dui:text-sm dui:[&>svg]:size-3.5 dui:[&>svg]:text-muted-foreground",
          defaultClassNames.caption_label
        ),
        month_grid: cn("dui:w-full dui:border-collapse", defaultClassNames.month_grid),
        weekdays: cn("dui:flex", defaultClassNames.weekdays),
        weekday: cn(
          "dui:flex-1 dui:rounded-(--cell-radius) dui:text-[0.8rem] dui:font-normal dui:text-muted-foreground dui:select-none",
          defaultClassNames.weekday
        ),
        week: cn("dui:mt-2 dui:flex dui:w-full", defaultClassNames.week),
        week_number_header: cn(
          "dui:w-(--cell-size) dui:select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "dui:text-[0.8rem] dui:text-muted-foreground dui:select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          "dui:group/day dui:relative dui:aspect-square dui:h-full dui:w-full dui:rounded-(--cell-radius) dui:p-0 dui:text-center dui:select-none dui:[&:last-child[data-selected=true]_button]:rounded-e-(--cell-radius)",
          props.showWeekNumber
            ? "dui:[&:nth-child(2)[data-selected=true]_button]:rounded-s-(--cell-radius)"
            : "dui:[&:first-child[data-selected=true]_button]:rounded-s-(--cell-radius)",
          defaultClassNames.day
        ),
        range_start: cn(
          "dui:relative dui:isolate dui:z-0 dui:rounded-s-(--cell-radius) dui:bg-muted dui:after:absolute dui:after:inset-y-0 dui:after:end-0 dui:after:w-4 dui:after:bg-muted",
          defaultClassNames.range_start
        ),
        range_middle: cn("dui:rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "dui:relative dui:isolate dui:z-0 dui:rounded-e-(--cell-radius) dui:bg-muted dui:after:absolute dui:after:inset-y-0 dui:after:start-0 dui:after:w-4 dui:after:bg-muted",
          defaultClassNames.range_end
        ),
        today: cn(
          "dui:rounded-(--cell-radius) dui:bg-muted dui:text-foreground dui:data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "dui:text-muted-foreground dui:aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "dui:text-muted-foreground dui:opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("dui:invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("dui:size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon className={cn("dui:size-4", className)} {...props} />
            )
          }

          return (
            <ChevronDownIcon className={cn("dui:size-4", className)} {...props} />
          )
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="dui:flex dui:size-(--cell-size) dui:items-center dui:justify-center dui:text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "dui:relative dui:isolate dui:z-10 dui:flex dui:aspect-square dui:size-auto dui:w-full dui:min-w-(--cell-size) dui:flex-col dui:gap-1 dui:border-0 dui:leading-none dui:font-normal dui:group-data-[focused=true]/day:relative dui:group-data-[focused=true]/day:z-10 dui:group-data-[focused=true]/day:border-ring dui:group-data-[focused=true]/day:ring-[3px] dui:group-data-[focused=true]/day:ring-ring/50 dui:data-[range-end=true]:rounded-(--cell-radius) dui:data-[range-end=true]:rounded-e-(--cell-radius) dui:data-[range-end=true]:bg-primary dui:data-[range-end=true]:text-primary-foreground dui:data-[range-middle=true]:rounded-none dui:data-[range-middle=true]:bg-muted dui:data-[range-middle=true]:text-foreground dui:data-[range-start=true]:rounded-(--cell-radius) dui:data-[range-start=true]:rounded-s-(--cell-radius) dui:data-[range-start=true]:bg-primary dui:data-[range-start=true]:text-primary-foreground dui:data-[selected-single=true]:bg-primary dui:data-[selected-single=true]:text-primary-foreground dui:dark:hover:text-foreground dui:[&>span]:text-xs dui:[&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
