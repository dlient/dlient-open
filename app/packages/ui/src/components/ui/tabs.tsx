"use client"

import * as React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "../../lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "dui:group/tabs dui:flex dui:gap-2 dui:data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "dui:group/tabs-list dui:inline-flex dui:items-center dui:justify-center dui:rounded-lg dui:p-[3px] dui:text-muted-foreground dui:group-data-horizontal/tabs:h-8 dui:group-data-vertical/tabs:h-fit dui:group-data-vertical/tabs:flex-col dui:data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "dui:bg-muted",
        line: "dui:gap-1 dui:bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface TabsListProps
  extends React.ComponentProps<typeof TabsPrimitive.List>,
    VariantProps<typeof tabsListVariants> {
  /**
   * 启用溢出滚动：tab 超出显示范围时，左右显示箭头按钮，点击平滑滚动。
   * 缺省 false = 原行为（不包滚动容器、无箭头）。
   */
  scrollable?: boolean
  /** 左侧自定义按钮（渲染在最左，滚动区/箭头之外；如「新建 tab」+） */
  leading?: React.ReactNode
  /** 右侧自定义按钮（渲染在最右） */
  trailing?: React.ReactNode
}

function TabsList({
  className,
  variant = "default",
  scrollable,
  leading,
  trailing,
  ...props
}: TabsListProps) {
  // 非 scrollable：原路径，完全向后兼容
  if (!scrollable) {
    return (
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    )
  }
  return (
    <ScrollableTabsList
      className={className}
      variant={variant}
      leading={leading}
      trailing={trailing}
      {...props}
    />
  )
}

function ScrollableTabsList({
  className,
  variant = "default",
  leading,
  trailing,
  ...props
}: Omit<TabsListProps, "scrollable">) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState({ left: false, right: false })

  // 箭头宽度（size-6 = 24px）：滚动位置小于等于箭头宽时隐藏对应箭头（不遮挡已到边的 tab）
  const ARROW_W = 24

  const update = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScroll({
      left: scrollLeft > ARROW_W,
      right: scrollLeft + clientWidth < scrollWidth - ARROW_W,
    })
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener("scroll", update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("scroll", update)
    }
  }, [update])

  // 点击箭头滚动：目标位置落在左右箭头宽（ARROW_W）内时吸附到两端，
  // 保证第一个 / 最后一个 tab 完全显示。判断放在这里而不是 update()，
  // 避免平滑滚动中途被 update 的 scroll 事件把位置拉回而无法滚动。
  const scroll = (dir: -1 | 1) => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollWidth, clientWidth } = el
    const maxLeft = Math.max(0, scrollWidth - clientWidth)
    const target = el.scrollLeft + dir * 180
    const next = target <= ARROW_W ? 0 : target >= maxLeft - ARROW_W ? maxLeft : target
    el.scrollTo({ left: next, behavior: "smooth" })
  }

  // 外层 div：负责定位 + 圆角 8px + overflow hidden（把内部按钮及其阴影裁剪到圆角内），
  // pointer-events-none 不拦截下层 tabs 点击；按钮层提供宽度/背景/阴影与交互。
  // 背景跟随 tabs：card→muted，line→background（不透明，滚动时遮挡下方 tabs）。
  const arrowWrapClass =
    "dui:pointer-events-none dui:absolute dui:top-0 dui:bottom-0 dui:z-10 dui:flex dui:w-10 "
  const arrowBtnClass = cn(
    "dui:pointer-events-auto dui:flex dui:h-full dui:w-6 dui:shrink-0 dui:cursor-pointer dui:items-center dui:justify-center dui:text-muted-foreground",
    variant === "line" ? "dui:bg-background" : "dui:bg-muted"
  )
  const leftArrowBtnClass = cn(
    arrowBtnClass,
    "dui:shadow-[4px_0_8px_-3px_color-mix(in_oklch,var(--foreground)_25%,transparent)]"
  )
  const rightArrowBtnClass = cn(
    arrowBtnClass,
    "dui:shadow-[-4px_0_8px_-3px_color-mix(in_oklch,var(--foreground)_25%,transparent)]"
  )

  return (
    <div className="dui:flex dui:items-center dui:gap-1">
      {leading}
      <div className="dui:relative dui:min-w-0 dui:flex-1 dui:overflow-hidden dui:rounded-[8px]">
        <div
          ref={scrollerRef}
          data-slot="tabs-list-scroller"
          className="dui:overflow-x-auto dui:no-scrollbar"
        >
          <TabsPrimitive.List
            data-slot="tabs-list"
            data-variant={variant}
            className={cn(tabsListVariants({ variant }), "dui:w-max", className)}
            {...props}
          />
        </div>
        {canScroll.left && (
          <div className={cn(arrowWrapClass, "dui:left-0")}>
            <div
              role="button"
              data-slot="tabs-list-scroll-left"
              onClick={() => scroll(-1)}
              aria-label="Scroll tabs left"
              className={leftArrowBtnClass}
            >
              <ChevronLeft className="dui:size-4" />
            </div>
          </div>
        )}
        {canScroll.right && (
          <div className={cn(arrowWrapClass, "dui:right-0 dui:justify-end")}>
            <div
              role="button"
              data-slot="tabs-list-scroll-right"
              onClick={() => scroll(1)}
              aria-label="Scroll tabs right"
              className={rightArrowBtnClass}
            >
              <ChevronRight className="dui:size-4" />
            </div>
          </div>
        )}
      </div>
      {trailing}
    </div>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "dui:relative dui:inline-flex dui:h-[calc(100%-1px)] dui:flex-1 dui:items-center dui:justify-center dui:gap-1.5 dui:rounded-md dui:border dui:border-transparent dui:px-1.5 dui:py-0.5 dui:text-xs dui:font-medium dui:whitespace-nowrap dui:text-foreground/60 dui:transition-all dui:group-data-vertical/tabs:w-full dui:group-data-vertical/tabs:justify-start dui:group-data-vertical/tabs:py-[calc(--spacing(1.25))] dui:data-[state=inactive]:hover:text-foreground dui:focus-visible:border-ring dui:focus-visible:ring-[3px] dui:focus-visible:ring-ring/50 dui:focus-visible:outline-1 dui:focus-visible:outline-ring dui:disabled:pointer-events-none dui:disabled:opacity-50 dui:has-data-[icon=inline-end]:pe-1 dui:has-data-[icon=inline-start]:ps-1 dui:dark:data-[state=inactive]:text-muted-foreground dui:dark:data-[state=inactive]:hover:text-foreground dui:[&_svg]:pointer-events-none dui:[&_svg]:shrink-0 dui:[&_svg:not([class*=size-])]:size-3.5",
        "dui:group-data-[variant=line]/tabs-list:bg-transparent dui:group-data-[variant=line]/tabs-list:data-active:bg-transparent dui:group-data-[variant=line]/tabs-list:data-active:text-foreground dui:dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dui:dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "dui:data-active:bg-primary dui:data-active:text-primary-foreground",
        "dui:after:absolute dui:after:bg-foreground dui:after:opacity-0 dui:after:transition-opacity dui:group-data-horizontal/tabs:after:inset-x-0 dui:group-data-horizontal/tabs:after:bottom-[-5px] dui:group-data-horizontal/tabs:after:h-0.5 dui:group-data-vertical/tabs:after:inset-y-0 dui:group-data-vertical/tabs:after:-end-1 dui:group-data-vertical/tabs:after:w-0.5 dui:group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("dui:flex-1 dui:text-xs/relaxed dui:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
