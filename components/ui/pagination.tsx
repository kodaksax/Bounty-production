import { MaterialIcons } from "@expo/vector-icons"
import { ButtonProps, buttonVariants } from "components/ui/button"
import { cn } from "lib/utils"
import * as React from "react"
import { Text, TouchableOpacity, View } from "react-native"

interface PaginationProps {
  // ...other props...
}

const Pagination = ({ className, ...props }: React.ComponentProps<typeof View>) => (
  <View
    accessibilityRole="toolbar"
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
)
Pagination.displayName = "Pagination"

const PaginationContent = React.forwardRef<
  View,
  React.ComponentProps<typeof View>
>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
))
PaginationContent.displayName = "PaginationContent"

const PaginationItem = React.forwardRef<
  View,
  React.ComponentProps<typeof View>
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("", className)} {...props} />
))
PaginationItem.displayName = "PaginationItem"

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<ButtonProps, "size"> &
  React.ComponentProps<typeof TouchableOpacity>

const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) => (
  <TouchableOpacity
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }),
      className
    )}
    {...props}
  />
)
PaginationLink.displayName = "PaginationLink"

const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="default"
    className={cn("gap-1 pl-2.5", className)}
    {...props}
  >
    <MaterialIcons name="keyboard-arrow-left" size={24} color="#000000" />
    <Text>Previous</Text>
  </PaginationLink>
)
PaginationPrevious.displayName = "PaginationPrevious"

const PaginationNext = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to next page"
    size="default"
    className={cn("gap-1 pr-2.5", className)}
    {...props}
  >
    <Text>Next</Text>
    <MaterialIcons name="keyboard-arrow-right" size={24} color="#000000" />
  </PaginationLink>
)
PaginationNext.displayName = "PaginationNext"

const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<typeof Text>) => (
  <Text
    accessible={false}
    accessibilityLabel="More pages"
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MaterialIcons name="more-horiz" size={24} color="#000000" />
  </Text>
)
PaginationEllipsis.displayName = "PaginationEllipsis"

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
}

