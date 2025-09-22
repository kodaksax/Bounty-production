"use client"

import * as React from "react"
import { TouchableOpacity, View } from "react-native"

// Minimal RN Tooltip primitives — these do not implement hover/toolip behavior
// as in web. They provide a simple API so call sites compile and can opt-in to
// an RN tooltip implementation later.

const TooltipProvider: React.FC<any> = ({ children }) => <>{children}</>

const Tooltip: React.FC<any> = ({ children }) => <>{children}</>

const TooltipTrigger = ({ asChild = false, children, ...props }: any) => {
  if (asChild && React.isValidElement(children)) {
    // Clone the child and merge props so call sites that pass asChild work.
    return React.cloneElement(children as React.ReactElement, { ...(props as any) })
  }

  return <TouchableOpacity {...(props as any)}>{children}</TouchableOpacity>
}

const TooltipContent = React.forwardRef<View, any>(({ children, ...props }, ref) => (
  <View ref={ref} {...(props as any)}>
    {children}
  </View>
))
TooltipContent.displayName = "TooltipContent"

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }

