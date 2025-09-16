import * as React from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { Slot } from "@radix-ui/react-slot"
import { MaterialIcons } from "@expo/vector-icons"

import { cn } from "lib/utils"

const Breadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"nav"> & {
    separator?: React.ReactNode
  }
>(({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />)
Breadcrumb.displayName = "Breadcrumb"

const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<"ol">
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
      className
    )}
    {...props}
  />
))
BreadcrumbList.displayName = "BreadcrumbList"

const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<"li">
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("inline-flex items-center gap-1.5", className)}
    {...props}
  />
))
BreadcrumbItem.displayName = "BreadcrumbItem"

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & {
    asChild?: boolean
  }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      ref={ref}
      className={cn("transition-colors hover:text-foreground", className)}
      {...props}
    />
  )
})
BreadcrumbLink.displayName = "BreadcrumbLink"

const BreadcrumbText = React.forwardRef<
  React.ComponentRef<typeof Text>,
  React.ComponentPropsWithRef<typeof Text> & { className?: string }
>(({ className, accessibilityRole, accessibilityLabel, style, ...props }, ref) => (
  <Text
    ref={ref}
    // use accessibilityRole instead of role (React Native)
    accessibilityRole={accessibilityRole ?? "text"}
    accessibilityLabel={accessibilityLabel}
    // If you use nativewind/tailwind on RN, prefer className; otherwise pass a StyleProp<TextStyle>
    className={className}
    // merge any style objects (don't pass a plain string)
    style={Array.isArray(style) ? style : [style]}
    {...props}
  />
))
 BreadcrumbText.displayName = "BreadcrumbText"

const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn("[&>svg]:w-3.5 [&>svg]:h-3.5", className)}
    {...props}
  >
    {children ?? <MaterialIcons name="keyboard-arrow-right" size={24} color="#000000" />}
  </li>
)
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"



export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,

}
