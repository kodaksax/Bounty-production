import * as React from "react"
import { StyleProp, StyleSheet, Text, TextProps, TextStyle, View, ViewProps, ViewStyle } from "react-native"

interface CardProps extends ViewProps {
  variant?: "default" | "elevated"
  className?: string
  children?: React.ReactNode
}

type CardVariant = "default" | "elevated";

// Narrow the variant map to only the view-style keys we expect
const cardVariantMap: Record<CardVariant, 'base' | 'elevated'> = {
  default: "base",
  elevated: "elevated",
};

const Card = ({ variant = "default", style, children, ...props }: CardProps) => (
  <View
    style={[cardStyles[cardVariantMap[variant]], style]}
    {...props}
  >
    {children}
  </View>
)
Card.displayName = "Card"

interface CardHeaderProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const CardHeader = React.forwardRef<View, CardHeaderProps>(
  ({ style, children, ...props }, ref) => (
    <View
      ref={ref}
      style={[cardStyles.header, style]}
      {...props}
    >
      {children}
    </View>
  )
)
CardHeader.displayName = "CardHeader"

interface CardTextProps extends TextProps {
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

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

interface CardContentProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const CardContent = React.forwardRef<View, CardContentProps>(
  ({ style, children, ...props }, ref) => (
    <View ref={ref} style={[cardStyles.content, style]} {...props}>
      {children}
    </View>
  )
)
CardContent.displayName = "CardContent"

interface CardFooterProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const CardFooter = React.forwardRef<View, CardFooterProps>(
  ({ style, children, ...props }, ref) => (
    <View
      ref={ref}
      style={[cardStyles.footer, style]}
      {...props}
    >
      {children}
    </View>
  )
)
CardFooter.displayName = "CardFooter"

interface CardStyles {
  base: ViewStyle
  elevated: ViewStyle
  header: ViewStyle
  title: TextStyle
  description: TextStyle
  content: ViewStyle
  footer: ViewStyle
}

const cardStyles = StyleSheet.create<CardStyles>({
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

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }

