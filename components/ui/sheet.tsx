"use client"

import { MaterialIcons } from "@expo/vector-icons"
// Replace Radix dialog primitives with RN-friendly wrappers
import { cva } from "class-variance-authority"
import * as React from "react"
import { Text, View } from "react-native"


const Sheet: React.FC<any> = ({ children }) => <>{children}</>

const SheetTrigger: React.FC<any> = ({ asChild = false, children, ...props }) => {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement, { ...(props as any) })
  }
  return <TouchableOpacity {...(props as any)}>{children}</TouchableOpacity>
}

const SheetClose: React.FC<any> = ({ children, ...props }) => (
  <TouchableOpacity {...(props as any)}>{children}</TouchableOpacity>
)

const SheetPortal: React.FC<{ children?: React.ReactNode }> = ({ children }) => <>{children}</>

const SheetOverlay = React.forwardRef<View, any>(({ children, ...props }, ref) => (
  <View ref={ref} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)' }} {...(props as any)}>
    {children}
  </View>
))
SheetOverlay.displayName = "SheetOverlay"

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps {
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  style?: any
}

const SheetContent = React.forwardRef<View, SheetContentProps>(({ side = "right", className, children, open, onOpenChange, style, ...props }, ref) => (
  <SheetPortal>
    {open ? <SheetOverlay /> : null}
    <View ref={ref} style={[{ backgroundColor: '#fff', padding: 16 }, style as any]} {...(props as any)}>
      {children}
      <SheetClose onPress={() => onOpenChange?.(false)} style={{ position: 'absolute', right: 16, top: 16 }}>
        <MaterialIcons name="close" size={24} color="#000000" />
        <Text style={{ position: 'absolute', left: -9999 }}>Close</Text>
      </SheetClose>
    </View>
  </SheetPortal>
))
SheetContent.displayName = "SheetContent"

const SheetHeader = ({ className, ...props }: any) => (
  <View style={{ flexDirection: 'column', gap: 8 }} {...(props as any)} />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({ className, ...props }: any) => (
  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }} {...(props as any)} />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<Text, any>(({ children, ...props }, ref) => (
  <Text ref={ref as any} style={{ fontSize: 18, fontWeight: '600' }} {...(props as any)}>{children}</Text>
))
SheetTitle.displayName = "SheetTitle"

const SheetDescription = React.forwardRef<Text, any>(({ children, ...props }, ref) => (
  <Text ref={ref as any} style={{ fontSize: 14, color: '#6b7280' }} {...(props as any)}>{children}</Text>
))
SheetDescription.displayName = "SheetDescription"

export {
  Sheet, SheetClose,
  SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetOverlay, SheetPortal, SheetTitle, SheetTrigger
}

