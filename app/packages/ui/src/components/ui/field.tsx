"use client"

import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"
import { Label } from "./label"
import { Separator } from "./separator"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "dui:flex dui:flex-col dui:gap-4 dui:has-[>[data-slot=checkbox-group]]:gap-3 dui:has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "dui:mb-2 dui:font-medium dui:data-[variant=label]:text-xs/relaxed dui:data-[variant=legend]:text-sm",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "dui:group/field-group dui:@container/field-group dui:flex dui:w-full dui:flex-col dui:gap-4 dui:data-[slot=checkbox-group]:gap-3 dui:*:data-[slot=field-group]:gap-4",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva(
  "dui:group/field dui:flex dui:w-full dui:gap-2 dui:data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: "dui:flex-col dui:*:w-full dui:[&>.sr-only]:w-auto",
        horizontal:
          "dui:flex-row dui:items-center dui:has-[>[data-slot=field-content]]:items-start dui:*:data-[slot=field-label]:flex-auto dui:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "dui:flex-col dui:*:w-full dui:@md/field-group:flex-row dui:@md/field-group:items-center dui:@md/field-group:*:w-auto dui:@md/field-group:has-[>[data-slot=field-content]]:items-start dui:@md/field-group:*:data-[slot=field-label]:flex-auto dui:[&>.sr-only]:w-auto dui:@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "dui:group/field-content dui:flex dui:flex-1 dui:flex-col dui:gap-0.5 dui:leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "dui:group/field-label dui:peer/field-label dui:flex dui:w-fit dui:gap-2 dui:leading-snug dui:group-data-[disabled=true]/field:opacity-50 dui:has-data-checked:bg-primary/5 dui:has-[>[data-slot=field]]:rounded-md dui:has-[>[data-slot=field]]:border dui:has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-input/40 dui:has-[>[data-slot=field]]:has-[:focus-visible]:border-ring dui:has-[>[data-slot=field]]:has-[:focus-visible]:ring-2 dui:has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring/30 dui:*:data-[slot=field]:p-2 dui:dark:has-data-checked:bg-primary/10",
        "dui:has-[>[data-slot=field]]:w-full dui:has-[>[data-slot=field]]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "dui:flex dui:w-fit dui:items-center dui:gap-2 dui:text-xs/relaxed dui:font-medium dui:group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "dui:text-start dui:text-xs/relaxed dui:leading-normal dui:font-normal dui:text-muted-foreground dui:group-has-data-horizontal/field:text-balance dui:[[data-variant=legend]+&]:-mt-1.5",
        "dui:last:mt-0 dui:nth-last-2:-mt-1",
        "dui:[&>a]:underline dui:[&>a]:underline-offset-4 dui:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "dui:relative dui:-my-2 dui:h-5 dui:text-xs/relaxed dui:group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="dui:absolute dui:inset-0 dui:top-1/2" />
      {children && (
        <span
          className="dui:relative dui:mx-auto dui:block dui:w-fit dui:bg-background dui:px-2 dui:text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="dui:ms-4 dui:flex dui:list-disc dui:flex-col dui:gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("dui:text-xs/relaxed dui:font-normal dui:text-destructive", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}
