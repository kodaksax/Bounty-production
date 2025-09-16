"use client"

import * as React from 'react'
import { View } from 'react-native'

// Minimal RN-friendly Resizable wrappers to satisfy imports.
const ResizablePanelGroup = ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => (
  <View style={{ flex: 1 }} {...props}>
    {children}
  </View>
)

const ResizablePanel = ({ children, ...props }: { children?: React.ReactNode }) => (
  <View {...props}>{children}</View>
)

const ResizableHandle = ({ withHandle }: { withHandle?: boolean }) => (
  <View>
    {withHandle && <View />}
  </View>
)

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }

