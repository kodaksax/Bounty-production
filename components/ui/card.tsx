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

// Import design tokens
import { COLORS, SPACING, RADIUS, SHADOWS, TYPOGRAPHY } from "../../lib/constants/accessibility";

const cardStyles = StyleSheet.create<CardStyles>({
  base: {
    borderRadius: RADIUS.LG,
    backgroundColor: COLORS.BG_SECONDARY, // emerald-700 for cards
    ...SHADOWS.SM, // Subtle shadow for depth
    borderWidth: 1,
    borderColor: COLORS.BORDER_SUBTLE, // emerald-300 with opacity
  },
  elevated: {
    ...SHADOWS.MD, // More prominent shadow for elevation
    borderColor: COLORS.BORDER_DEFAULT, // emerald-700
  },
  header: {
    paddingTop: SPACING.SECTION_GAP,
    paddingHorizontal: SPACING.SECTION_GAP,
    paddingBottom: SPACING.COMPACT_GAP,
  },
  title: {
    fontSize: TYPOGRAPHY.SIZE_XLARGE,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 4,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_XLARGE * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
  description: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_SMALL * TYPOGRAPHY.LINE_HEIGHT_RELAXED),
  },
  content: {
    paddingHorizontal: SPACING.SECTION_GAP,
    paddingTop: 0,
    paddingBottom: SPACING.SECTION_GAP,
  },
  footer: {
    paddingHorizontal: SPACING.SECTION_GAP,
    paddingTop: 0,
    paddingBottom: SPACING.SECTION_GAP,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.BORDER_SUBTLE,
    marginTop: SPACING.ELEMENT_GAP,
    paddingTop: SPACING.ELEMENT_GAP,
  },
})

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }

