"use client"

import * as React from "react"
import { TouchableOpacity, View } from "react-native"

import { cn } from "lib/utils"

type RadioGroupProps = {
  value?: string
  onValueChange?: (value: string) => void
  className?: string
  children?: React.ReactNode
}

export const RadioGroup = ({ value, onValueChange, className, children }: RadioGroupProps) => {
  // Render children as-is; callers should use RadioGroupItem which will
  // manage its checked state via context or props. For simplicity, we
  // just render a container that preserves className.
  return (
    <View // @ts-ignore
      className={cn(className)}
    >
      {children}
    </View>
  )
}

type RadioGroupItemProps = {
  value: string
  checked?: boolean
  onPress?: () => void
  className?: string
}

export const RadioGroupItem = ({ value, checked, onPress, className }: RadioGroupItemProps) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      // @ts-ignore
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-primary flex items-center justify-center",
        className
      )}
    >
      {checked ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#111827' }} /> : null}
    </TouchableOpacity>
  )
}

export default RadioGroup
