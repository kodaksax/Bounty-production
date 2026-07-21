import { useAppThemeContext } from "lib/themes"
import * as React from "react"
import { StyleProp, StyleSheet, Text, TextProps, TextStyle, View, ViewProps, ViewStyle } from "react-native"

interface CardProps extends ViewProps {
  variant?: "default" | "elevated"
  className?: string
  children?: React.ReactNode
}

const Card = ({ variant = "default", style, children, ...props }: CardProps) => {
  const { theme } = useAppThemeContext();

  return (
    <View
      style={[
        {
          borderRadius: theme.radius.md,
          backgroundColor: theme.surface,
          ...theme.shadows.sm,
        },
        variant === "elevated" && theme.shadows.md,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  )
}
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
  ({ style, children, ...props }, ref) => {
    const { theme } = useAppThemeContext();
    return (
      <Text
        ref={ref}
        style={[cardStyles.title, { color: theme.text }, style]}
        {...props}
      >
        {children}
      </Text>
    );
  }
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<Text, CardTextProps>(
  ({ style, children, ...props }, ref) => {
    const { theme } = useAppThemeContext();
    return (
      <Text
        ref={ref}
        style={[cardStyles.description, { color: theme.textSecondary }, style]}
        {...props}
      >
        {children}
      </Text>
    );
  }
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
  header: ViewStyle
  title: TextStyle
  description: TextStyle
  content: ViewStyle
  footer: ViewStyle
}

const cardStyles = StyleSheet.create<CardStyles>({
  header: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
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

