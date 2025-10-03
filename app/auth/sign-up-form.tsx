"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { AlertDescription, Alert as BannerAlert } from "components/ui/alert"
import { Button } from "components/ui/button"
import { Input } from "components/ui/input"
import { Label } from "components/ui/label"
import { useRouter } from 'expo-router'
import React, { useEffect, useRef, useState } from "react"
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native"

// (legacy helper removed; inlined in handleSubmit)

export default function SignUpRoute() {
  return <SignUpForm />
}

export function SignUpForm(): React.ReactElement {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  function isFormValid() {
    const emailValid = email.length > 5;
    const usernameValid = username.length >= 3;
    const passwordValid = password.length >= 6;
    const passwordsMatch = confirmPassword === password;
    return emailValid && usernameValid && passwordValid && passwordsMatch && !isLoading;
  }
  const canSubmit = isFormValid();

  // Animated pulse for primed submit button
  const pulse = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (canSubmit) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
        ])
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(0);
    }
  }, [canSubmit, pulse]);


  const handleSubmit = async () => {
    setErrors({})
    setAuthError(null)
    setSuccess(false)

    // Basic frontend validation
    if (!email || !username || !password || !confirmPassword) {
      setErrors({ general: "All fields are required." })
      return
    }
    const emailValid = /.+@.+\..+/.test(email)
    if (!emailValid) {
      setErrors({ email: 'Invalid email address.' })
      return
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      setErrors({ username: 'Username 3-24 chars letters/numbers/_' })
      return
    }
    if (password.length < 6) {
      setErrors({ password: 'Password min 6 chars' })
      return
    }
    if (password !== confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' })
      return
    }

    try {
      setIsLoading(true)
      
      // Call backend sign-up endpoint
      const localHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
      const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || `http://${localHost}:3001`;
      
      const response = await fetch(`${baseUrl}/app/auth/sign-up-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), username: username.trim(), password })
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthError(data.error || 'Failed to create account');
        return;
      }

      // Success - clear form and show success message
      setEmail("");
      setUsername("");
      setPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setAuthError('An unexpected error occurred')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const getFieldError = (field: string) => {
    return errors[field]
  }

  // UI Layout (mobile friendly)
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
          <View className="items-center mb-10">
            <MaterialIcons name="gps-fixed" size={40} color="#fff" />
            <Text className="text-white font-extrabold text-3xl tracking-widest mt-2">BOUNTY</Text>
          </View>

          {/* Segmented Toggle */}
          <View className="flex-row mb-6 rounded-full overflow-hidden bg-black/30">
            <TouchableOpacity
              className="flex-1 py-2 items-center justify-center bg-emerald-500"
              onPress={() => { /* already here */ }}
              disabled
            >
              <Text className="text-white font-medium text-sm">Register</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 py-2 items-center justify-center"
              onPress={() => router.push('/auth/sign-in-form')}
            >
              <Text className="text-white/70 font-medium text-sm">Login</Text>
            </TouchableOpacity>
          </View>

          {success && (
            <View className="mb-4">
              <BannerAlert>
                <AlertDescription>
                  Check your email for a confirmation link. You&apos;ll need to confirm before signing in.
                </AlertDescription>
              </BannerAlert>
              <Button onPress={() => router.push('/auth/sign-in-form')} className="mt-3 w-full">Go to Sign In</Button>
            </View>
          )}

          {authError && !success && (
            <View className="mb-4">
              <BannerAlert variant="destructive">
                <AlertDescription>{authError}</AlertDescription>
              </BannerAlert>
            </View>
          )}

          {!success && (
            <View className="gap-5">
              <View>
                <Label>Email</Label>
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  editable={!isLoading}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                {getFieldError('email') && <Text className="text-xs text-red-400 mt-1">{getFieldError('email')}</Text>}
              </View>
              <View>
                <Label>Username</Label>
                <Input
                  value={username}
                  onChangeText={setUsername}
                  placeholder="username"
                  editable={!isLoading}
                  autoCapitalize="none"
                />
                {getFieldError('username') && <Text className="text-xs text-red-400 mt-1">{getFieldError('username')}</Text>}
              </View>
              <View>
                <Label>Password</Label>
                <View className="relative">
                  <Input
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    secureTextEntry={!showPassword}
                    editable={!isLoading}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
                {getFieldError('password') && <Text className="text-xs text-red-400 mt-1">{getFieldError('password')}</Text>}
              </View>
              <View>
                <Label>Confirm Password</Label>
                <View className="relative">
                  <Input
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm Password"
                    secureTextEntry={!showConfirmPassword}
                    editable={!isLoading}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    <MaterialIcons name={showConfirmPassword ? 'visibility-off' : 'visibility'} size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
                {getFieldError('confirmPassword') && <Text className="text-xs text-red-400 mt-1">{getFieldError('confirmPassword')}</Text>}
              </View>
              <Animated.View style={{ transform: [
                { scale: Animated.multiply(pulse.interpolate({ inputRange: [0,1], outputRange: [1, 1.035] }), pressScale) }
              ], shadowOpacity: canSubmit ? 0.35 : 0, shadowRadius: 12, shadowColor: '#10b981', shadowOffset: { width: 0, height: 4 } }}>
                
                {/* Create Account Button */}
                <Button
                  onPressIn={() => {
                    Animated.spring(pressScale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
                  }}
                  onPressOut={() => {
                    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
                  }}
                  onPress={handleSubmit}
                  className="w-full"
                  // disabled={!canSubmit || isLoading}
                >
                  {isLoading ? (
                    <>
                      <MaterialIcons name="hourglass-top" size={16} style={{ marginRight: 8 }} />
                      Creating account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </Button>
              </Animated.View>

              <Text className="text-[11px] text-center text-white/70 leading-4 px-2">
                By signing up, you accept our <Text className="text-emerald-200">conditions</Text>.
              </Text>

              <View className="items-center mt-2">
                <Text className="text-sm text-white/80">Have an account? </Text>
                <TouchableOpacity onPress={() => router.push('/auth/sign-in-form')} className="mt-1">
                  <Text className="text-emerald-200 text-sm font-medium">Login</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
