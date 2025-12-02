"use client"

import * as React from "react"
import { View } from "react-native"

import { cn } from "lib/utils"

type ProgressProps = {
  value?: number
  className?: string
  style?: any
  children?: React.ReactNode
}

export const Progress = ({ value = 0, className, style, children }: ProgressProps) => {
  return (
    <View
      style={[{ height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden' }, style]}
      // Preserve className prop for NativeWind usage elsewhere
      // @ts-ignore: className is valid for NativeWind on RN primitives
      className={cn(className)}
    >
      {children}
    </View>
  )
}

export const ProgressIndicator = ({ value = 0, className, style }: ProgressProps) => {
  const width = Math.max(0, Math.min(100, value))
  return (
    <View
      style={[{ height: '100%', backgroundColor: '#10B981', width: `${width}%` }, style]}
      // @ts-ignore
      className={cn(className)}
    />
  )
}

export default Progress
