"use client"

import * as React from "react"
import { ScrollView, View } from "react-native"

import { cn } from "lib/utils"

type ScrollAreaProps = {
  children?: React.ReactNode
  className?: string
  horizontal?: boolean
}

export const ScrollArea = ({ children, className, horizontal = false }: ScrollAreaProps) => {
  return (
    <ScrollView // @ts-ignore
      className={cn(className)}
      horizontal={horizontal}
    >
      {children}
    </ScrollView>
  )
}

export const ScrollBar = ({ className }: { className?: string }) => {
  return <View // @ts-ignore
    className={cn(className)}
  />
}

export default ScrollArea
