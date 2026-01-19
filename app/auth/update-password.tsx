"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { updatePassword, verifyResetToken } from 'lib/services/auth-service'
import { 
  calculatePasswordStrength, 
  getStrengthColor, 
  getStrengthWidth,
  validateNewPassword,
  validatePasswordMatch,
  type PasswordStrengthResult 
} from 'lib/utils/password-validation'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View } from 'react-native'
import { BrandingLogo } from '../../components/ui/branding-logo'

export default function UpdatePasswordRoute() { 
  return <UpdatePasswordScreen /> 
}

export function UpdatePasswordScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ token?: string; type?: string }>()
  
  // State management
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirmPassword?: string }>({})
  
  // Password strength tracking
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrengthResult | null>(null)

  // Verify the reset token on mount
  useEffect(() => {
    const verifyToken = async () => {
      const token = params.token
      // Type guard to ensure valid token type with fallback to 'recovery'
      const validTypes = ['recovery', 'signup', 'invite', 'email'] as const
      type TokenType = typeof validTypes[number]
      const type: TokenType = validTypes.includes(params.type as TokenType) 
        ? (params.type as TokenType) 
        : 'recovery'
      
      if (!token) {
        // No token provided - user may have navigated here directly
        // Allow them to proceed if they have a valid session from clicking the email link
        setVerifying(false)
        setTokenValid(true)
        return
      }

      try {
        const result = await verifyResetToken(token, type)
        setTokenValid(result.success)
        if (!result.success) {
          setError(result.message)
        }
      } catch {
        setError('Failed to verify reset link. Please request a new one.')
        setTokenValid(false)
      } finally {
        setVerifying(false)
      }
    }

    verifyToken()
  }, [params.token, params.type])

  // Update password strength as user types
  useEffect(() => {
    if (password) {
      setPasswordStrength(calculatePasswordStrength(password))
    } else {
      setPasswordStrength(null)
    }
  }, [password])

  const handleUpdatePassword = async () => {
    setError(null)
    setFieldErrors({})

    // Validate password
    const passwordError = validateNewPassword(password)
    if (passwordError) {
      setFieldErrors(prev => ({ ...prev, password: passwordError }))
      return
    }

    // Validate password match
    const matchError = validatePasswordMatch(password, confirmPassword)
    if (matchError) {
      setFieldErrors(prev => ({ ...prev, confirmPassword: matchError }))
      return
    }

    try {
      setLoading(true)
      const result = await updatePassword(password)

      if (result.success) {
        setSuccess(true)
      } else {
        setError(result.message)
      }
    } catch (e) {
      setError('An unexpected error occurred. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Show loading while verifying token
  if (verifying) {
    return (
      <View className="flex-1 bg-emerald-700/95 items-center justify-center">
        <ActivityIndicator size="large" color="#fff" />
        <Text className="text-white/80 mt-4">Verifying reset link...</Text>
      </View>
    )
  }

  // Show error if token is invalid
  if (!tokenValid && !success) {
    return (
      <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
        <View className="items-center">
          <View className="bg-red-500/20 rounded-full p-4 mb-4">
            <MaterialIcons name="error-outline" size={48} color="#f87171" />
          </View>
          <Text className="text-white font-bold text-xl mb-2">Invalid Reset Link</Text>
          <Text className="text-white/70 text-center text-sm px-4 mb-6">
            {error || 'This password reset link is invalid or has expired.'}
          </Text>
          <TouchableOpacity 
            onPress={() => router.push('/auth/reset-password')}
            className="bg-emerald-600 rounded-lg py-3 px-6 mb-4"
          >
            <Text className="text-white font-medium">Request New Reset Link</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/auth/sign-in-form')}>
            <Text className="text-white/80">Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // Show success screen
  if (success) {
    return (
      <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
        <View className="items-center">
          <View className="bg-emerald-500/30 rounded-full p-4 mb-4">
            <MaterialIcons name="check-circle" size={48} color="#34d399" />
          </View>
          <Text className="text-white font-bold text-xl mb-2">Password Updated!</Text>
          <Text className="text-white/70 text-center text-sm px-4 mb-6">
            Your password has been successfully updated. You can now sign in with your new password.
          </Text>
          <TouchableOpacity 
            onPress={() => router.replace('/auth/sign-in-form')}
            className="bg-emerald-600 rounded-lg py-3 px-6"
          >
            <View className="flex-row items-center">
              <MaterialIcons name="login" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text className="text-white font-medium">Sign In Now</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
          {/* Header */}
          <View className="flex-row items-center justify-center mb-6">
            <BrandingLogo size="large" />
          </View>

          {/* Title */}
          <View className="items-center mb-8">
            <View className="bg-white/10 rounded-full p-4 mb-4">
              <MaterialIcons name="lock" size={32} color="#fff" />
            </View>
            <Text className="text-white font-bold text-xl mb-2">Create New Password</Text>
            <Text className="text-white/70 text-center text-sm px-4">
              Enter a strong password to secure your account.
            </Text>
          </View>

          {/* Error Alert */}
          {error && (
            <View className="bg-red-500/20 border border-red-400 rounded-lg p-4 mb-4 flex-row items-start">
              <MaterialIcons name="error-outline" size={20} color="#f87171" style={{ marginTop: 2 }} />
              <View className="ml-3 flex-1">
                <Text className="text-red-200 text-sm">{error}</Text>
              </View>
              <TouchableOpacity onPress={() => setError(null)}>
                <MaterialIcons name="close" size={20} color="#f87171" />
              </TouchableOpacity>
            </View>
          )}

          <View className="gap-5">
            {/* New Password Field */}
            <View>
              <Text className="text-white/80 text-sm mb-1">New Password</Text>
              <View className="relative">
                <TextInput
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text)
                    if (fieldErrors.password) {
                      setFieldErrors(prev => ({ ...prev, password: undefined }))
                    }
                  }}
                  placeholder="Enter new password"
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                  editable={!loading}
                  className={`w-full bg-white/10 rounded-lg px-12 py-3 text-white ${
                    fieldErrors.password ? 'border border-red-400' : ''
                  }`}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
                <View className="absolute left-3 top-1/2 -translate-y-1/2">
                  <MaterialIcons name="lock" size={20} color="rgba(255,255,255,0.5)" />
                </View>
                <TouchableOpacity
                  onPress={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons 
                    name={showPassword ? 'visibility-off' : 'visibility'} 
                    size={20} 
                    color="rgba(255,255,255,0.7)" 
                  />
                </TouchableOpacity>
              </View>
              {fieldErrors.password && (
                <View className="flex-row items-center mt-2">
                  <MaterialIcons name="error-outline" size={14} color="#f87171" />
                  <Text className="text-red-400 text-xs ml-1">{fieldErrors.password}</Text>
                </View>
              )}

              {/* Password Strength Indicator */}
              {passwordStrength && (
                <View className="mt-3">
                  {/* Strength Bar */}
                  <View className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <View 
                      style={{
                        width: `${getStrengthWidth(passwordStrength.score)}%`,
                        height: '100%',
                        backgroundColor: getStrengthColor(passwordStrength.level),
                        borderRadius: 4,
                      }}
                    />
                  </View>
                  <Text 
                    style={{ color: getStrengthColor(passwordStrength.level) }}
                    className="text-xs mt-1 capitalize"
                  >
                    {passwordStrength.level.replace('-', ' ')}
                  </Text>

                  {/* Requirements Checklist */}
                  <View className="mt-3 bg-white/5 rounded-lg p-3">
                    <Text className="text-white/60 text-xs mb-2">Password must have:</Text>
                    {passwordStrength.requirements.map((req) => (
                      <View key={req.id} className="flex-row items-center mb-1">
                        <MaterialIcons 
                          name={req.met ? 'check-circle' : 'radio-button-unchecked'} 
                          size={14} 
                          color={req.met ? '#34d399' : 'rgba(255,255,255,0.4)'} 
                        />
                        <Text 
                          className={`text-xs ml-2 ${req.met ? 'text-emerald-300' : 'text-white/50'}`}
                        >
                          {req.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* Confirm Password Field */}
            <View>
              <Text className="text-white/80 text-sm mb-1">Confirm Password</Text>
              <View className="relative">
                <TextInput
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text)
                    if (fieldErrors.confirmPassword) {
                      setFieldErrors(prev => ({ ...prev, confirmPassword: undefined }))
                    }
                  }}
                  placeholder="Confirm new password"
                  secureTextEntry={!showConfirmPassword}
                  autoComplete="password-new"
                  editable={!loading}
                  className={`w-full bg-white/10 rounded-lg px-12 py-3 text-white ${
                    fieldErrors.confirmPassword ? 'border border-red-400' : ''
                  }`}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
                <View className="absolute left-3 top-1/2 -translate-y-1/2">
                  <MaterialIcons name="lock-outline" size={20} color="rgba(255,255,255,0.5)" />
                </View>
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons 
                    name={showConfirmPassword ? 'visibility-off' : 'visibility'} 
                    size={20} 
                    color="rgba(255,255,255,0.7)" 
                  />
                </TouchableOpacity>
              </View>
              {fieldErrors.confirmPassword && (
                <View className="flex-row items-center mt-2">
                  <MaterialIcons name="error-outline" size={14} color="#f87171" />
                  <Text className="text-red-400 text-xs ml-1">{fieldErrors.confirmPassword}</Text>
                </View>
              )}
              {/* Password match indicator */}
              {confirmPassword && password && !fieldErrors.confirmPassword && (
                <View className="flex-row items-center mt-2">
                  {password === confirmPassword ? (
                    <>
                      <MaterialIcons name="check-circle" size={14} color="#34d399" />
                      <Text className="text-emerald-300 text-xs ml-1">Passwords match</Text>
                    </>
                  ) : (
                    <>
                      <MaterialIcons name="cancel" size={14} color="#f87171" />
                      <Text className="text-red-400 text-xs ml-1">Passwords do not match</Text>
                    </>
                  )}
                </View>
              )}
            </View>

            {/* Update Password Button */}
            <TouchableOpacity 
              onPress={handleUpdatePassword} 
              disabled={loading || !passwordStrength?.isValid || password !== confirmPassword}
              className={`w-full rounded-lg py-4 items-center flex-row justify-center ${
                loading || !passwordStrength?.isValid || password !== confirmPassword
                  ? 'bg-emerald-600/50'
                  : 'bg-emerald-600'
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
              ) : (
                <MaterialIcons name="lock" size={20} color="#fff" style={{ marginRight: 8 }} />
              )}
              <Text className="text-white font-medium">
                {loading ? 'Updating Password...' : 'Update Password'}
              </Text>
            </TouchableOpacity>

            {/* Cancel Link */}
            <TouchableOpacity 
              onPress={() => router.push('/auth/sign-in-form')} 
              className="py-3 items-center"
            >
              <Text className="text-white/70">Cancel and return to Sign In</Text>
            </TouchableOpacity>
          </View>

          {/* Security Tips */}
          <View className="mt-auto pt-8">
            <View className="bg-white/5 rounded-lg p-4">
              <View className="flex-row items-center mb-2">
                <MaterialIcons name="lightbulb" size={16} color="rgba(255,255,255,0.6)" />
                <Text className="text-white/60 text-xs font-medium ml-2">Password Tips</Text>
              </View>
              <Text className="text-white/50 text-xs">
                • Use a unique password not used on other sites{'\n'}
                • Consider using a password manager{'\n'}
                • Avoid personal information like names or birthdays
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
