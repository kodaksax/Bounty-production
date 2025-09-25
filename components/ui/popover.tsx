"use client"

import * as React from "react"
import { Modal, TouchableOpacity, View } from "react-native"

// Minimal Popover wrapper for React Native while converting away from Radix
// This provides the same named exports used across the codebase but is
// implemented with RN primitives to avoid pulling in web-only Radix modules.

type PopoverProps = {
  children: React.ReactNode
}

function Popover({ children }: PopoverProps) {
  return <View>{children}</View>
}
Popover.displayName = 'Popover'

function PopoverTrigger({ children }: { children: React.ReactNode }) {
  return <TouchableOpacity>{children as any}</TouchableOpacity>
}
PopoverTrigger.displayName = 'PopoverTrigger'

const PopoverContent = React.forwardRef<any, any>(({ children, ..._props }, ref) => {
  return (
    <Modal transparent animationType="fade" ref={ref}>
      <View style={{ padding: 12 }}>{children}</View>
    </Modal>
  )
})
PopoverContent.displayName = 'PopoverContent'

export { Popover, PopoverContent, PopoverTrigger }

