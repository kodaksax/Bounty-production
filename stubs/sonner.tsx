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
}> = ({ children, theme }) => {
  return <View>{children}</View>
}

let warnedRealToast = false
export function toast(message: string | ToasterToast) {
  if (__DEV__ && !warnedRealToast) {
    console.warn('[sonner stub] Using toast() stub. Replace with a real RN toast implementation for production UI.')
    warnedRealToast = true
  }
  console.log('[toast]', message)
}

Object.defineProperty(exports, '__esModule', { value: true })
export default Toaster
