"use client"

import * as React from "react"
import { TouchableOpacity, View } from "react-native"
// Replace Radix ToggleGroup with RN-friendly wrapper
import { type VariantProps } from "class-variance-authority"

import { toggleVariants } from "components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

const ToggleGroup = React.forwardRef<any, React.PropsWithChildren<any>>(({ className, variant, size, children, ...props }, ref) => (
  <View ref={ref} style={{ flexDirection: 'row', gap: 4 }} {...(props as any)}>
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </View>
))

ToggleGroup.displayName = "ToggleGroup"

const ToggleGroupItem = React.forwardRef<any, React.PropsWithChildren<any>>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TouchableOpacity ref={ref as any} {...(props as any)}>
      {children}
    </TouchableOpacity>
  )
})

ToggleGroupItem.displayName = "ToggleGroupItem"

export { ToggleGroup, ToggleGroupItem }

