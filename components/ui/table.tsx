import * as React from "react"
import { View, Text, ScrollView, ViewProps, TextProps } from "react-native"

import { cn } from "lib/utils"

interface TableProps extends ViewProps {
  className?: string
}

const Table = React.forwardRef<View, TableProps>(
  ({ className, children, ...props }, ref) => (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      className={cn("w-full", className)}
    >
      <View
        ref={ref}
        className={cn("min-w-full", className)}
        {...props}
      >
        {children}
      </View>
    </ScrollView>
  )
)
Table.displayName = "Table"

interface TableSectionProps extends ViewProps {
  className?: string
}

const TableHeader = React.forwardRef<View, TableSectionProps>(
  ({ className, children, ...props }, ref) => (
    <View 
      ref={ref} 
      className={cn("border-b border-border", className)} 
      {...props}
    >
      {children}
    </View>
  )
)
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<View, TableSectionProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("", className)}
      {...props}
    >
      {children}
    </View>
  )
)
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<View, TableSectionProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "border-t border-border bg-muted/50",
        className
      )}
      {...props}
    >
      {children}
    </View>
  )
)
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<View, TableSectionProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "flex-row border-b border-border",
        className
      )}
      {...props}
    >
      {children}
    </View>
  )
)
TableRow.displayName = "TableRow"

interface TableCellProps extends ViewProps {
  className?: string
  children?: React.ReactNode
}

const TableHead = React.forwardRef<View, TableCellProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "flex-1 px-4 py-3 justify-center",
        className
      )}
      {...props}
    >
      <Text className={cn("font-medium text-muted-foreground text-sm")}>
        {children}
      </Text>
    </View>
  )
)
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<View, TableCellProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("flex-1 px-4 py-2 justify-center", className)}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text className="text-sm">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
)
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<View, TableCellProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("mt-4", className)}
      {...props}
    >
      <Text className={cn("text-sm text-muted-foreground text-center")}>
        {children}
      </Text>
    </View>
  )
)
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
