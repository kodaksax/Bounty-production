import { MaterialIcons } from '@expo/vector-icons'
import * as React from "react"
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from "react-native"
import { SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility'
import { theme as legacyTheme } from '../../lib/theme'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';


interface InputProps extends TextInputProps {
  variant?: "default" | "outline" | "filled"
  /**
   * Label shown above the input
   */
  label?: string
  /**
   * Error message to display (shows red border and error text)
   */
  error?: string
  /**
   * Helper text shown below the input
   */
  helperText?: string
  /**
   * Show success state (green border)
   */
  isValid?: boolean
  /**
   * Left icon name from MaterialIcons
   */
  leftIcon?: keyof typeof MaterialIcons.glyphMap
  /**
   * Right icon name from MaterialIcons
   */
  rightIcon?: keyof typeof MaterialIcons.glyphMap
  /**
   * Callback when right icon is pressed
   */
  onRightIconPress?: () => void
  /**
   * Custom container style
   */
  containerStyle?: object
}

const Input = React.forwardRef<TextInput, InputProps>(
  ({
    variant = "default",
    style,
    label,
    error,
    helperText,
    isValid,
    leftIcon,
    rightIcon,
    onRightIconPress,
    containerStyle,
    onFocus,
    onBlur,
    ...props
  }, ref) => {
  const { theme } = useAppThemeContext();
  const inputStyles = React.useMemo(() => makeInputStyles(theme), [theme]);
    const [isFocused, setIsFocused] = React.useState(false)
    const borderAnim = React.useRef(new Animated.Value(0)).current
    const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false)

    // Check for reduced motion preference
    React.useEffect(() => {
      const checkMotionPreference = async () => {
        try {
          const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled()
          setPrefersReducedMotion(isReduceMotionEnabled)
        } catch {
          setPrefersReducedMotion(false)
        }
      }
      checkMotionPreference()
    }, [])

    const handleFocus = React.useCallback((e: any) => {
      setIsFocused(true)
      if (!prefersReducedMotion) {
        Animated.timing(borderAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: false,
        }).start()
      }
      onFocus?.(e)
    }, [onFocus, prefersReducedMotion, borderAnim])

    const handleBlur = React.useCallback((e: any) => {
      setIsFocused(false)
      if (!prefersReducedMotion) {
        Animated.timing(borderAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: false,
        }).start()
      }
      onBlur?.(e)
    }, [onBlur, prefersReducedMotion, borderAnim])

    // Determine border color based on state
    const getBorderColor = () => {
      if (error) return theme.error
      if (isValid) return theme.primary
      if (isFocused) return theme.primary
      return theme.border
    }

    const animatedBorderColor = borderAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [theme.border, theme.primary],
    })

    // Generate unique ID for accessibility
    const inputId = React.useId()
    const errorId = `${inputId}-error`
    const helperId = `${inputId}-helper`

    return (
      <View style={[inputStyles.container, containerStyle]}>
        {label && (
          <Text
            style={[inputStyles.label, error && inputStyles.labelError]}
            nativeID={`${inputId}-label`}
          >
            {label}
          </Text>
        )}

        <Animated.View
          style={[
            inputStyles.inputContainer,
            inputStyles[variant],
            isFocused && inputStyles.focused,
            error && inputStyles.errorBorder,
            isValid && inputStyles.validBorder,
            {
              borderColor: error ? theme.error : isValid ? theme.primary : prefersReducedMotion ? getBorderColor() : animatedBorderColor
            },
          ]}
        >
          {leftIcon && (
            <MaterialIcons
              name={leftIcon}
              size={20}
              color={error ? theme.errorText : isFocused ? theme.primaryLight : theme.textSecondary}
              style={inputStyles.leftIcon}
            />
          )}

          <TextInput
            style={[
              inputStyles.base,
              leftIcon && inputStyles.inputWithLeftIcon,
              rightIcon && inputStyles.inputWithRightIcon,
              style
            ]}
            ref={ref}
            placeholderTextColor={theme.textSecondary}
            onFocus={handleFocus}
            onBlur={handleBlur}
            accessible={true}
            accessibilityLabel={label}
            accessibilityHint={error || helperText}
            accessibilityState={{
              disabled: props.editable === false,
            }}
            {...props}
          />

          {rightIcon && onRightIconPress && (
            <TouchableOpacity
              onPress={onRightIconPress}
              accessibilityRole="button"
              accessibilityLabel={`${rightIcon} action`}
              style={inputStyles.rightIconButton}
            >
              <MaterialIcons
                name={rightIcon}
                size={20}
                color={error ? theme.errorText : isFocused ? theme.primaryLight : theme.textSecondary}
              />
            </TouchableOpacity>
          )}

          {rightIcon && !onRightIconPress && (
            <MaterialIcons
              name={rightIcon}
              size={20}
              color={error ? theme.errorText : isFocused ? theme.primaryLight : theme.textSecondary}
              style={inputStyles.rightIcon}
              accessibilityElementsHidden={true}
            />
          )}

          {isValid && !rightIcon && (
            <MaterialIcons
              name="check-circle"
              size={20}
              color={theme.primaryLight}
              style={inputStyles.rightIcon}
              accessibilityLabel="Valid input"
            />
          )}
        </Animated.View>

        {error && (
          <View style={inputStyles.errorContainer}>
            <MaterialIcons name="error-outline" size={14} color={theme.errorText} />
            <Text
              style={inputStyles.errorText}
              nativeID={errorId}
              accessibilityRole="alert"
            >
              {error}
            </Text>
          </View>
        )}

        {helperText && !error && (
          <Text
            style={inputStyles.helperText}
            nativeID={helperId}
          >
            {helperText}
          </Text>
        )}
      </View>
    )
  }
)
Input.displayName = "Input"

function makeInputStyles(theme: AppTheme) {
  return StyleSheet.create({
  container: {
    marginBottom: SPACING.ELEMENT_GAP,
  },
  label: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: SPACING.COMPACT_GAP / 2,
  },
  labelError: {
    color: theme.errorText,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: theme.surfaceSecondary,
    overflow: 'hidden',
  },
  base: {
    flex: 1,
    height: SIZING.BUTTON_HEIGHT_DEFAULT,
    paddingHorizontal: SPACING.ELEMENT_GAP,
    paddingVertical: SPACING.COMPACT_GAP,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    color: theme.text,
  },
  inputWithLeftIcon: {
    paddingLeft: SPACING.COMPACT_GAP,
  },
  inputWithRightIcon: {
    paddingRight: SPACING.COMPACT_GAP,
  },
  default: {
    borderColor: theme.border,
  },
  outline: {
    borderWidth: 2,
    borderColor: theme.info,
  },
  filled: {
    backgroundColor: theme.surfaceSecondary,
    borderColor: 'transparent',
  },
  focused: {
    borderColor: theme.primary, // emerald-600
    ...legacyTheme.shadows.sm,
  },

  errorBorder: {
    borderColor: theme.error,
  },
  validBorder: {
    borderColor: theme.primary,
  },
  leftIcon: {
    marginLeft: SPACING.ELEMENT_GAP,
  },
  rightIcon: {
    marginRight: SPACING.ELEMENT_GAP,
  },
  rightIconButton: {
    padding: SPACING.COMPACT_GAP,
    marginRight: SPACING.COMPACT_GAP,
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.COMPACT_GAP / 2,
    gap: 4,
  },
  errorText: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: theme.errorText,
  },
  helperText: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: theme.textSecondary,
    marginTop: SPACING.COMPACT_GAP / 2,
  },
})
}

export { Input }
