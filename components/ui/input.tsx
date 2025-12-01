import * as React from "react"
import { 
  TextInput, 
  TextInputProps, 
  StyleSheet, 
  View, 
  Text, 
  Animated,
  AccessibilityInfo,
  TouchableOpacity,
} from "react-native"
import { MaterialIcons } from '@expo/vector-icons'
import { SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility'

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
      if (isValid) return '#10b981' // emerald-500
      if (isFocused) return '#059669' // emerald-600
      return variant === 'outline' ? '#3b82f6' : '#d1d5db'
    }

    const animatedBorderColor = borderAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['#d1d5db', '#059669'],
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
              borderColor: error ? '#ef4444' : isValid ? '#10b981' : 
                prefersReducedMotion ? getBorderColor() : animatedBorderColor 
            },
          ]}
        >
          {leftIcon && (
            <MaterialIcons 
              name={leftIcon} 
              size={20} 
              color={error ? '#ef4444' : isFocused ? '#059669' : '#9ca3af'}
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
            placeholderTextColor="#9ca3af"
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
                color={error ? '#ef4444' : isFocused ? '#059669' : '#9ca3af'}
              />
            </TouchableOpacity>
          )}
          
          {rightIcon && !onRightIconPress && (
            <MaterialIcons 
              name={rightIcon} 
              size={20} 
              color={error ? '#ef4444' : isFocused ? '#059669' : '#9ca3af'}
              style={inputStyles.rightIcon}
              accessibilityElementsHidden={true}
            />
          )}
          
          {isValid && !rightIcon && (
            <MaterialIcons 
              name="check-circle" 
              size={20} 
              color="#10b981"
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
    color: '#374151', // gray-700
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
    color: '#1f2937', // gray-800
  },
  inputWithLeftIcon: {
    paddingLeft: SPACING.COMPACT_GAP,
  },
  inputWithRightIcon: {
    paddingRight: SPACING.COMPACT_GAP,
  },
  default: {
    borderColor: '#d1d5db',
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
    borderColor: '#059669', // emerald-600
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  errorBorder: {
    borderColor: '#ef4444',
  },
  validBorder: {
    borderColor: '#10b981',
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
    color: '#6b7280', // gray-500
    marginTop: SPACING.COMPACT_GAP / 2,
  },
})

export { Input }
