import * as React from "react"
import { View, ViewProps, Text, StyleSheet } from "react-native"

interface CardProps extends ViewProps {
  variant?: "default" | "elevated"
}

interface CardTextProps extends ViewProps {
  children?: React.ReactNode
}

const Card = React.forwardRef<View, CardProps>(
  ({ variant = "default", style, ...props }, ref) => (
    <View
      ref={ref}
      style={[cardStyles.base, cardStyles[variant], style]}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<View, CardTextProps>(
  ({ style, ...props }, ref) => (
    <View
      ref={ref}
      style={[cardStyles.header, style]}
      {...props}
    />
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<Text, CardTextProps>(
  ({ style, children, ...props }, ref) => (
    <Text
      ref={ref}
      style={[cardStyles.title, style]}
      {...props}
    >
      {children}
    </Text>
  )
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<Text, CardTextProps>(
  ({ style, children, ...props }, ref) => (
    <Text
      ref={ref}
      style={[cardStyles.description, style]}
      {...props}
    >
      {children}
    </Text>
  )
)
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<View, CardTextProps>(
  ({ style, ...props }, ref) => (
    <View ref={ref} style={[cardStyles.content, style]} {...props} />
  )
)
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<View, CardTextProps>(
  ({ style, ...props }, ref) => (
    <View
      ref={ref}
      style={[cardStyles.footer, style]}
      {...props}
    />
  )
)
CardFooter.displayName = "CardFooter"

const cardStyles = StyleSheet.create({
  base: {
    borderRadius: 8,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  elevated: {
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: '#6b7280',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
})

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
