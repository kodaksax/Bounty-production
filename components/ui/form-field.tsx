import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Input } from './input';

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad' | 'decimal-pad';
  autoComplete?: 'email' | 'password' | 'name' | 'tel' | 'off';
  required?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  maxLength?: number;
  helpText?: string;
  leftIcon?: keyof typeof MaterialIcons.glyphMap;
  rightIcon?: keyof typeof MaterialIcons.glyphMap;
  onRightIconPress?: () => void;
  variant?: 'default' | 'outline';
  testID?: string;
}

export function FormField({
  label,
  value,
  onChangeText,
  onBlur,
  error,
  touched,
  placeholder,
  secureTextEntry,
  keyboardType = 'default',
  autoComplete,
  required,
  disabled,
  multiline,
  numberOfLines = 1,
  maxLength,
  helpText,
  leftIcon,
  rightIcon,
  onRightIconPress,
  variant = 'default',
  testID,
}: FormFieldProps) {
  const hasError = !!(error && touched);
  const showError = hasError;
  const showHelp = helpText && !showError;

  return (
    <View style={styles.container}>
      {/* Label */}
      <View style={styles.labelContainer}>
        <Text style={[styles.label, hasError && styles.labelError]}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
        {maxLength && value.length > 0 && (
          <Text style={[styles.counter, value.length > maxLength && styles.counterError]}>
            {value.length}/{maxLength}
          </Text>
        )}
      </View>

      {/* Input Container */}
      <View style={styles.inputContainer}>
        {leftIcon && (
          <MaterialIcons
            name={leftIcon}
            size={20}
            color={hasError ? '#dc2626' : 'rgba(255, 255, 255, 0.7)'}
            style={styles.leftIcon}
            accessibilityElementsHidden={true}
          />
        )}
        
        <Input
          variant={hasError ? 'outline' : variant}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          editable={!disabled}
          multiline={multiline}
          numberOfLines={numberOfLines}
          maxLength={maxLength}
          error={hasError ? error : undefined}
          style={[
            leftIcon && styles.inputWithLeftIcon,
            rightIcon && styles.inputWithRightIcon,
            multiline && { height: numberOfLines * 20 + 24, textAlignVertical: 'top' },
            disabled && styles.inputDisabled,
          ]}
          accessibilityLabel={label}
          accessibilityHint={helpText}
          testID={testID}
        />

        {rightIcon && (
          <MaterialIcons
            name={rightIcon}
            size={20}
            color={hasError ? '#dc2626' : 'rgba(255, 255, 255, 0.7)'}
            style={styles.rightIcon}
            onPress={onRightIconPress}
            accessibilityRole={onRightIconPress ? 'button' : 'none'}
            accessibilityLabel={
              rightIcon === 'visibility' ? 'Show password' :
              rightIcon === 'visibility-off' ? 'Hide password' :
              rightIcon === 'clear' ? 'Clear input' :
              undefined
            }
          />
        )}
      </View>

      {/* Help Text / Error Message */}
      {showError && (
        <View style={styles.messageContainer}>
          <MaterialIcons
            name="error"
            size={16}
            color="#dc2626"
            style={styles.messageIcon}
            accessibilityElementsHidden={true}
          />
          <Text
            style={styles.errorText}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        </View>
      )}
      
      {showHelp && (
        <View style={styles.messageContainer}>
          <MaterialIcons
            name="info"
            size={16}
            color="rgba(255, 255, 255, 0.6)"
            style={styles.messageIcon}
            accessibilityElementsHidden={true}
          />
          <Text style={styles.helpText}>{helpText}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  labelError: {
    color: '#fca5a5',
  },
  required: {
    color: '#dc2626',
    fontWeight: '700',
  },
  counter: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  counterError: {
    color: '#dc2626',
  },
  inputContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftIcon: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
  },
  rightIcon: {
    position: 'absolute',
    right: 16,
    zIndex: 1,
  },
  inputWithLeftIcon: {
    paddingLeft: 48,
  },
  inputWithRightIcon: {
    paddingRight: 48,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  messageIcon: {
    marginRight: 6,
  },
  errorText: {
    fontSize: 14,
    color: '#fca5a5',
    fontWeight: '500',
    flex: 1,
  },
  helpText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '400',
    flex: 1,
    lineHeight: 20,
  },
});