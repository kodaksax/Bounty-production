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
    borderRadius: 16,
    backgroundColor: 'rgba(16, 20, 24, 0.8)', // spy-surface
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.3)',
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
    // Glass-morphism effect
    overflow: 'hidden',
  },
  elevated: {
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
    // Add subtle glow for elevated cards
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  header: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  description: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 20,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(55, 65, 81, 0.2)',
    marginTop: 12,
    paddingTop: 16,
  },
})

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }

