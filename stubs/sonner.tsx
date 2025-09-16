// Minimal stub for `sonner` used in this project.
import * as React from 'react'
import { View } from 'react-native'

export type ToasterToast = {
  id?: string
  title?: React.ReactNode
  description?: React.ReactNode
  duration?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  action?: React.ReactNode
}

export const Toaster: React.FC<{
  position?: string
  theme?: string
  className?: string
  toastOptions?: any
  children?: React.ReactNode
}> = ({ children }) => {
  return <View>{children}</View>
}

export function toast(message: string | ToasterToast) {
  // noop stub: in RN you might use a different toast implementation
  console.log('toast:', message)
}

export default Toaster
