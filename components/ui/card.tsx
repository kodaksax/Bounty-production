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
    backgroundColor: 'rgba(0, 87, 26, 0.3)', // emerald-700 with opacity for glass effect
    borderWidth: 1,
    borderColor: 'rgba(0, 145, 44, 0.3)', // emerald-600 border
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
    // Add subtle emerald glow for elevated cards
    borderColor: 'rgba(0, 145, 44, 0.4)', // emerald-600
    shadowColor: '#00912C', // emerald-600 glow
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
    paddingTop: 16,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 145, 44, 0.2)', // emerald-600 border
    marginTop: 12,
  },
})

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }

