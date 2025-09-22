"use client"

import * as React from "react"
import { Text, TouchableOpacity, View } from "react-native"

import { cn } from "lib/utils"

// Minimal RN-friendly Select wrapper. Exports the same symbol names as
// the Radix-based implementation so other files importing these symbols
// won't error during the porting process. This is intentionally simple
// and should be replaced with a full-featured RN Picker-based component
// where needed.

export const Select = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <View // @ts-ignore
    className={cn(className)}
  >
    {children}
  </View>
)

export const SelectGroup = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>

export const SelectValue = ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>

export const SelectTrigger = React.forwardRef<any, any>(({ children, className, ...props }, ref) => (
  <TouchableOpacity ref={ref} // @ts-ignore
    className={cn(className)}
    {...props}
  >
    {children}
  </TouchableOpacity>
))

export const SelectContent = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <View // @ts-ignore
    className={cn(className)}
  >
    {children}
  </View>
)

export const SelectLabel = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <Text // @ts-ignore
    className={cn(className)}
  >
    {children}
  </Text>
)

export const SelectItem = React.forwardRef<any, any>(({ children, className, ...props }, ref) => (
  <TouchableOpacity ref={ref} // @ts-ignore
    className={cn(className)}
    {...props}
  >
    <Text>{children}</Text>
  </TouchableOpacity>
))

export const SelectSeparator = ({ className }: { className?: string }) => (
  <View // @ts-ignore
    className={cn(className)}
  />
)

export default Select
