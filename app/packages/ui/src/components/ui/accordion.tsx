import * as React from "react"
import { Accordion as AccordionPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

function Accordion({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn(
        "dui:flex dui:w-full dui:flex-col dui:overflow-hidden dui:rounded-md dui:border",
        className
      )}
      {...props}
    />
  )
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("dui:not-last:border-b dui:data-open:bg-muted/50", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="dui:flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "dui:group/accordion-trigger dui:relative dui:flex dui:flex-1 dui:items-start dui:justify-between dui:gap-6 dui:border dui:border-transparent dui:p-2 dui:text-start dui:text-xs/relaxed dui:font-medium dui:transition-all dui:outline-none dui:hover:underline dui:disabled:pointer-events-none dui:disabled:opacity-50 dui:**:data-[slot=accordion-trigger-icon]:ms-auto dui:**:data-[slot=accordion-trigger-icon]:size-4 dui:**:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon data-slot="accordion-trigger-icon" className="dui:pointer-events-none dui:shrink-0 dui:group-aria-expanded/accordion-trigger:hidden" />
        <ChevronUpIcon data-slot="accordion-trigger-icon" className="dui:pointer-events-none dui:hidden dui:shrink-0 dui:group-aria-expanded/accordion-trigger:inline" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="dui:overflow-hidden dui:px-2 dui:text-xs/relaxed dui:data-open:animate-accordion-down dui:data-closed:animate-accordion-up"
      {...props}
    >
      <div
        className={cn(
          "dui:h-(--radix-accordion-content-height) dui:pt-0 dui:pb-4 dui:[&_a]:underline dui:[&_a]:underline-offset-3 dui:[&_a]:hover:text-foreground dui:[&_p:not(:last-child)]:mb-4",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
