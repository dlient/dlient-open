"use client"

import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"

import { cn } from "../../lib/utils"
import { MinusIcon } from "lucide-react"

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "cn-input-otp flex items-center has-disabled:opacity-50",
        containerClassName
      )}
      spellCheck={false}
      className={cn("dui:disabled:cursor-not-allowed", className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn(
        "dui:flex dui:items-center dui:rounded-md dui:has-aria-invalid:border-destructive dui:has-aria-invalid:ring-2 dui:has-aria-invalid:ring-destructive/20 dui:dark:has-aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  index: number
}) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        "dui:relative dui:flex dui:size-7 dui:items-center dui:justify-center dui:border-y dui:border-e dui:border-input dui:bg-input/20 dui:text-xs/relaxed dui:transition-all dui:outline-none dui:first:rounded-s-md dui:first:border-s dui:last:rounded-e-md dui:aria-invalid:border-destructive dui:data-[active=true]:z-10 dui:data-[active=true]:border-ring dui:data-[active=true]:ring-2 dui:data-[active=true]:ring-ring/30 dui:data-[active=true]:aria-invalid:border-destructive dui:data-[active=true]:aria-invalid:ring-destructive/20 dui:dark:bg-input/30 dui:dark:data-[active=true]:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="dui:pointer-events-none dui:absolute dui:inset-0 dui:flex dui:items-center dui:justify-center">
          <div className="dui:h-4 dui:w-px dui:animate-caret-blink dui:bg-foreground dui:duration-1000" />
        </div>
      )}
    </div>
  )
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-separator"
      className="dui:flex dui:items-center dui:[&_svg:not([class*=size-])]:size-4"
      role="separator"
      {...props}
    >
      <MinusIcon
      />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
