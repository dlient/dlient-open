"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "dui:relative dui:flex dui:w-full dui:touch-none dui:items-center dui:select-none dui:data-disabled:opacity-50 dui:data-vertical:h-full dui:data-vertical:min-h-40 dui:data-vertical:w-auto dui:data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="dui:relative dui:grow dui:overflow-hidden dui:rounded-md dui:bg-muted dui:data-horizontal:h-1 dui:data-horizontal:w-full dui:data-vertical:h-full dui:data-vertical:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="dui:absolute dui:bg-primary dui:select-none dui:data-horizontal:h-full dui:data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="dui:relative dui:block dui:size-3 dui:shrink-0 dui:rounded-md dui:border dui:border-ring dui:bg-white dui:ring-ring/30 dui:transition-[color,box-shadow] dui:select-none dui:after:absolute dui:after:-inset-2 dui:hover:ring-2 dui:focus-visible:ring-2 dui:focus-visible:outline-hidden dui:active:ring-2 dui:disabled:pointer-events-none dui:disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
