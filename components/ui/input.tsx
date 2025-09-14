import * as React from "react"
import { TextInput, TextInputProps } from "react-native"

import { cn } from "lib/utils"

interface InputProps extends TextInputProps {
  className?: string
}

const Input = React.forwardRef<TextInput, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <TextInput
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
