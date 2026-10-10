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
import { theme } from '../../lib/theme'


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
      if (error) return '#ef4444' // red-500
      if (isValid) return '#008E2A' // emerald-500
      if (isFocused) return '#008E2A' // emerald-600
      return variant === 'outline' ? '#3b82f6' : '#D8D2C4'
    }

    const animatedBorderColor = borderAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['#D8D2C4', '#008E2A'],
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
              borderColor: error ? '#ef4444' : isValid ? '#008E2A' :
                prefersReducedMotion ? getBorderColor() : animatedBorderColor
            },
          ]}
        >
          {leftIcon && (
            <MaterialIcons
              name={leftIcon}
              size={20}
              color={error ? '#ef4444' : isFocused ? '#008E2A' : '#929497'}
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
            placeholderTextColor="#929497"
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
                color={error ? '#ef4444' : isFocused ? '#008E2A' : '#929497'}
              />
            </TouchableOpacity>
          )}

          {rightIcon && !onRightIconPress && (
            <MaterialIcons
              name={rightIcon}
              size={20}
              color={error ? '#ef4444' : isFocused ? '#008E2A' : '#929497'}
              style={inputStyles.rightIcon}
              accessibilityElementsHidden={true}
            />
          )}

          {isValid && !rightIcon && (
            <MaterialIcons
              name="check-circle"
              size={20}
              color="#008E2A"
              style={inputStyles.rightIcon}
              accessibilityLabel="Valid input"
            />
          )}
        </Animated.View>

        {error && (
          <View style={inputStyles.errorContainer}>
            <MaterialIcons name="error-outline" size={14} color="#ef4444" />
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

const inputStyles = StyleSheet.create({
  container: {
    marginBottom: SPACING.ELEMENT_GAP,
  },
  label: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '600',
    color: '#454952', // gray-700
    marginBottom: SPACING.COMPACT_GAP / 2,
  },
  labelError: {
    color: '#ef4444',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  base: {
    flex: 1,
    height: SIZING.BUTTON_HEIGHT_DEFAULT,
    paddingHorizontal: SPACING.ELEMENT_GAP,
    paddingVertical: SPACING.COMPACT_GAP,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    color: '#2A2E35', // gray-800
  },
  inputWithLeftIcon: {
    paddingLeft: SPACING.COMPACT_GAP,
  },
  inputWithRightIcon: {
    paddingRight: SPACING.COMPACT_GAP,
  },
  default: {
    borderColor: '#D8D2C4',
  },
  outline: {
    borderWidth: 2,
    borderColor: '#3b82f6',
  },
  filled: {
    backgroundColor: '#f3f4f6', // gray-100
    borderColor: 'transparent',
  },
  focused: {
    borderColor: '#008E2A', // emerald-600
    ...theme.shadows.sm,
  },

  errorBorder: {
    borderColor: '#ef4444',
  },
  validBorder: {
    borderColor: '#008E2A',
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
    color: '#ef4444',
  },
  helperText: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: '#61656B', // gray-500
    marginTop: SPACING.COMPACT_GAP / 2,
  },
})

export { Input }
