"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { resetConsumedRecoveryLink } from 'lib/auth/consume-auth-link'
import { updatePassword } from 'lib/services/auth-service'
import { supabase } from 'lib/supabase'
import {
    calculatePasswordStrength,
    getStrengthColor,
    getStrengthWidth,
    validateNewPassword,
    validatePasswordMatch,
    type PasswordStrengthResult
} from 'lib/utils/password-validation'
import { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { BrandingLogo } from '../../components/ui/branding-logo'
import { useAuthContext } from '../../hooks/use-auth-context'
import { ROUTES } from '../../lib/routes'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation'

export default function UpdatePasswordRoute() {
  return <UpdatePasswordScreen />
}

export function UpdatePasswordScreen() {
  const router = useRouter()
  const { theme } = useAppThemeContext()
  const { endPasswordRecovery } = useAuthContext()

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

  // Blocks a second in-flight updateUser() from a double tap. A ref, not state,
  // because the guard has to hold within a single event-loop turn — a setState
  // would not have landed yet.
  const submittingRef = useRef(false)

  // Password strength tracking
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrengthResult | null>(null)

  /**
   * Confirm there is a live session to update, by asking Supabase rather than
   * inferring it from navigation state.
   *
   * This screen used to take `?token=` off the URL and call `verifyResetToken()`
   * again — but app/auth/callback.tsx has already exchanged that token, and
   * recovery tokens are single-use, so the second call was guaranteed to fail
   * and show "Invalid Reset Link" on a perfectly good reset. Worse, when no
   * token was present it set `tokenValid` to true unconditionally, so a user
   * with no session at all reached the form and only discovered the problem
   * after typing a new password twice.
   *
   * The session is the ground truth: `updateUser({ password })` needs exactly
   * that and nothing else.
   */
  useEffect(() => {
    let cancelled = false

    const confirmSession = async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (cancelled) return

        if (sessionError || !data?.session?.access_token) {
          setTokenValid(false)
          setError(
            'This password reset link is no longer valid. Reset links expire after one hour and can only be used once.'
          )
        } else {
          setTokenValid(true)
        }
      } catch {
        if (cancelled) return
        setTokenValid(false)
        setError('We could not verify your reset link. Please request a new one.')
      } finally {
        if (!cancelled) setVerifying(false)
      }
    }

    void confirmSession()
    return () => {
      cancelled = true
    }
  }, [])

  // Update password strength as user types
  useEffect(() => {
    if (password) {
      setPasswordStrength(calculatePasswordStrength(password))
    } else {
      setPasswordStrength(null)
    }
  }, [password])

  const handleUpdatePassword = async () => {
    // Duplicate-submission guard. `loading` alone is not enough: two taps in the
    // same tick both read the pre-render value.
    if (submittingRef.current) return
    submittingRef.current = true

    setError(null)
    setFieldErrors({})

    // Validate password
    const passwordError = validateNewPassword(password)
    if (passwordError) {
      setFieldErrors(prev => ({ ...prev, password: passwordError }))
      submittingRef.current = false
      return
    }

    // Validate password match
    const matchError = validatePasswordMatch(password, confirmPassword)
    if (matchError) {
      setFieldErrors(prev => ({ ...prev, confirmPassword: matchError }))
      submittingRef.current = false
      return
    }

    try {
      setLoading(true)
      const result = await updatePassword(password)

      if (result.success) {
        // Clear both halves of recovery state before showing success, so nothing
        // can route the user back into the reset flow afterwards: the provider
        // flag drives the root gate, and the module-level consumed marker is
        // what lets a re-delivered link be recognised as a repeat.
        try {
          endPasswordRecovery?.()
        } catch {
          // Never let bookkeeping mask a successful password change.
        }
        resetConsumedRecoveryLink()
        setSuccess(true)
      } else if (result.error === 'token_expired' || result.error === 'session_expired') {
        // The recovery session lapsed between opening the link and submitting.
        // Drop to the invalid-link screen, which offers a fresh reset — leaving
        // the form up would just fail again on every retry.
        setTokenValid(false)
        setError(result.message)
      } else {
        setError(result.message)
      }
    } catch (e) {
      setError('An unexpected error occurred. Please try again.')
      // The thrown value is logged, never the password.
      console.error('[update-password] Unexpected error updating password', e)
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  const inputStyle = {
    color: theme.text,
    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary,
    borderRadius: 8,
    paddingLeft: 48,
    paddingRight: 48,
    paddingVertical: 12,
    fontSize: 16,
  }

  // Show loading while verifying token
  if (verifying) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text className="mt-4" style={{ color: theme.text }}>Verifying reset link...</Text>
      </View>
    )
  }

  // Show error if token is invalid
  if (!tokenValid && !success) {
    return (
      <View className="flex-1 px-6 pt-20 pb-8" style={{ backgroundColor: theme.background }}>
        <View className="items-center">
          <View className="bg-red-500/20 rounded-full p-4 mb-4">
            <MaterialIcons name="error-outline" size={48} color="#f87171" />
          </View>
          <Text className="font-bold text-xl mb-2" style={{ color: theme.text }}>Invalid Reset Link</Text>
          <Text className="text-center text-sm px-4 mb-6" style={{ color: theme.text }}>
            {error || 'This password reset link is invalid or has expired.'}
          </Text>
          <TouchableOpacity
            onPress={() => {
              router.replace(ROUTES.AUTH.RESET_PASSWORD)
              try { markInitialNavigationDone(); } catch {}
            }}
            className="bg-[#059669] rounded-lg py-3 px-6 mb-4"
          >
            <Text className="text-white font-medium">Request New Reset Link</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => {
            router.replace(ROUTES.AUTH.SIGN_IN)
            try { markInitialNavigationDone(); } catch {}
          }}>
            <Text style={{ color: theme.text }}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // Show success screen
  if (success) {
    return (
      <View className="flex-1 px-6 pt-20 pb-8" style={{ backgroundColor: theme.background }}>
        <View className="items-center">
          <View className="bg-[#059669]/30 rounded-full p-4 mb-4">
            <MaterialIcons name="check-circle" size={48} color="#059669" />
          </View>
          <Text className="font-bold text-xl mb-2" style={{ color: theme.text }}>Password Updated!</Text>
          <Text className="text-center text-sm px-4 mb-6" style={{ color: theme.text }}>
            Your password has been successfully updated and you&apos;re signed in with it.
          </Text>
          <TouchableOpacity
            onPress={() => {
              // The session established by the reset link is still valid after
              // updateUser() succeeds — routing to the root gate (instead of back
              // to the sign-in form) lets it detect the authenticated session and
              // continue straight into the app instead of asking for credentials
              // the user just set.
              router.replace(ROUTES.ROOT)
              try { markInitialNavigationDone(); } catch {}
            }}
            className="bg-[#059669] rounded-lg py-3 px-6"
          >
            <View className="flex-row items-center">
              <MaterialIcons name="arrow-forward" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text className="text-white font-medium">Continue</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 px-6 pt-20 pb-8" style={{ backgroundColor: theme.background }}>
          {/* Header */}
          <View className="flex-row items-center justify-center mb-6">
            <BrandingLogo size="large" />
          </View>

          {/* Title */}
          <View className="items-center mb-8">
            <View className="rounded-full p-4 mb-4" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
              <MaterialIcons name="lock" size={32} color={theme.text} />
            </View>
            <Text className="font-bold text-xl mb-2" style={{ color: theme.text }}>Create New Password</Text>
            <Text className="text-center text-sm px-4" style={{ color: theme.text }}>
              Enter a strong password to secure your account.
            </Text>
          </View>

          {/* Error Alert */}
          {error && (
            <View className="bg-red-500/20 border border-red-400 rounded-lg p-4 mb-4 flex-row items-start">
              <MaterialIcons name="error-outline" size={20} color="#f87171" style={{ marginTop: 2 }} />
              <View className="ml-3 flex-1">
                <Text style={{ color: theme.isDark ? '#fecaca' : '#991b1b', fontSize: 14 }}>{error}</Text>
              </View>
              <TouchableOpacity onPress={() => setError(null)}>
                <MaterialIcons name="close" size={20} color="#f87171" />
              </TouchableOpacity>
            </View>
          )}

          <View className="gap-5">
            {/* New Password Field */}
            <View>
              <Text className="text-sm mb-1" style={{ color: theme.text }}>New Password</Text>
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
                  textContentType={Platform.OS === 'ios' ? 'newPassword' : undefined}
                  editable={!loading}
                  style={[inputStyle, fieldErrors.password ? { borderWidth: 1, borderColor: '#f87171' } : {}]}
                  placeholderTextColor={theme.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'}
                />
                <View className="absolute left-3 top-1/2 -translate-y-1/2">
                  <MaterialIcons name="lock" size={20} color={theme.textSecondary} />
                </View>
                <TouchableOpacity
                  onPress={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons
                    name={showPassword ? 'visibility-off' : 'visibility'}
                    size={20}
                    color={theme.textSecondary}
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
                  <View className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
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
                  <View className="mt-3 rounded-lg p-3" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
                    <Text className="text-xs mb-2" style={{ color: theme.textSecondary }}>Password must have:</Text>
                    {passwordStrength.requirements.map((req) => (
                      <View key={req.id} className="flex-row items-center mb-1">
                        <MaterialIcons
                          name={req.met ? 'check-circle' : 'radio-button-unchecked'}
                          size={14}
                          color={req.met ? '#059669' : theme.textSecondary}
                        />
                        <Text
                          className="text-xs ml-2"
                          style={{ color: req.met ? '#6ee7b7' : theme.textSecondary }}
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
              <Text className="text-sm mb-1" style={{ color: theme.text }}>Confirm Password</Text>
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
                  textContentType={Platform.OS === 'ios' ? 'newPassword' : undefined}
                  editable={!loading}
                  style={[inputStyle, fieldErrors.confirmPassword ? { borderWidth: 1, borderColor: '#f87171' } : {}]}
                  placeholderTextColor={theme.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'}
                />
                <View className="absolute left-3 top-1/2 -translate-y-1/2">
                  <MaterialIcons name="lock-outline" size={20} color={theme.textSecondary} />
                </View>
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons
                    name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                    size={20}
                    color={theme.textSecondary}
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
                      <MaterialIcons name="check-circle" size={14} color="#059669" />
                      <Text className="text-[#6ee7b7] text-xs ml-1">Passwords match</Text>
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
                  ? 'bg-[#059669]/50'
                  : 'bg-[#059669]'
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
              onPress={() => router.replace(ROUTES.AUTH.SIGN_IN)}
              className="py-3 items-center"
            >
              <Text style={{ color: theme.text }}>Cancel and return to Sign In</Text>
            </TouchableOpacity>
          </View>

          {/* Security Tips */}
          <View className="mt-auto pt-8">
            <View className="rounded-lg p-4" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
              <View className="flex-row items-center mb-2">
                <MaterialIcons name="lightbulb" size={16} color={theme.textSecondary} />
                <Text className="text-xs font-medium ml-2" style={{ color: theme.textSecondary }}>Password Tips</Text>
              </View>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>
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
