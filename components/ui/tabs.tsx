"use client"

import * as React from "react"
import { TouchableOpacity, View } from "react-native"

// Minimal RN Tabs wrappers — they don't implement keyboard or focus
// behavior; they provide a compatible API surface for compile-time.

const Tabs: React.FC<{ children?: React.ReactNode }> = ({ children }) => <>{children}</>

const TabsList = React.forwardRef<View, { className?: string; children?: React.ReactNode }>((props, ref) => (
  <View ref={ref} style={{ flexDirection: 'row' }} {...(props as any)}>
    {props.children}
  </View>
))
TabsList.displayName = "TabsList"

const TabsTrigger = React.forwardRef<any, React.PropsWithChildren<any>>(({ children, ...props }, ref) => (
  <TouchableOpacity ref={ref as any} {...(props as any)}>
    {children}
  </TouchableOpacity>
))
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = React.forwardRef<View, { className?: string; children?: React.ReactNode }>(({ children, ...props }, ref) => (
  <View ref={ref} {...(props as any)}>
    {children}
  </View>
))
TabsContent.displayName = "TabsContent"

export { Tabs, TabsContent, TabsList, TabsTrigger }

