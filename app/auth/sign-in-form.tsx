"use client"

import type React from "react"
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native"

import { useNavigation } from "@react-navigation/native"
import { Alert, AlertDescription } from "components/ui/alert"
import { useState } from "react"

export default function SignInRoute() {
  return <SignInForm />
}

export function SignInForm() {
  const navigation = useNavigation<any>()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async () => {
    setErrors({})
    setAuthError(null)

    // Basic frontend validation
    if (!email || !password) {
      setErrors({ general: "Email and password are required." })
      return
    }

    try {
      setIsLoading(true)

      // TODO: Replace with your Hostinger backend API endpoint
      const response = await fetch(`${process.env.API_BASE_URL || 'http://localhost:3001'}/auth/sign-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        setAuthError(data.message || "Failed to sign in.")
        return
      }

      // --- Authentication Success ---
      // Your backend should return a token (e.g., JWT) to store.
      // AsyncStorage.setItem('authToken', data.token);

  // Navigate to Dashboard screen (adjust route name to your navigator)
  // @ts-ignore
  navigation.navigate("Dashboard")
      
    } catch (err) {
      setAuthError("An unexpected error occurred")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const getFieldError = (field: string) => {
    return errors[field]
  }

  return (
    <View className="space-y-4">
      {authError && (
        <Alert variant="destructive">
          <AlertDescription>{authError}</AlertDescription>
        </Alert>
      )}
      <View className="space-y-2">
        <Text nativeID="email-label" className="text-sm">Email</Text>
        <TextInput
          nativeID="email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!isLoading}
          className="w-full bg-white/5 rounded p-3 text-white"
        />
        {getFieldError("email") && <Text className="text-sm text-red-500">{getFieldError("email")}</Text>}
      </View>

      <View className="space-y-2">
        <View className="flex items-center justify-between">
          <Text nativeID="password-label">Password</Text>
          <TouchableOpacity onPress={() => { /* adjust to navigate to reset screen */ navigation.navigate('ResetPassword') }}>
            <Text className="p-0 h-auto text-xs">Forgot password?</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          nativeID="password"
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          editable={!isLoading}
          className="w-full bg-white/5 rounded p-3 text-white"
        />
        {getFieldError("password") && <Text className="text-sm text-red-500">{getFieldError("password")}</Text>}
      </View>

      <TouchableOpacity onPress={handleSubmit} disabled={isLoading} className="w-full bg-emerald-600 rounded p-3 items-center">
        {isLoading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
            <Text className="text-white">Signing in...</Text>
          </View>
        ) : (
          <Text className="text-white">Sign In</Text>
        )}
      </TouchableOpacity>

      <View className="items-center">
        <Text className="text-center text-sm">Don&apos;t have an account? </Text>
          <TouchableOpacity onPress={() => { navigation.navigate('SignUp') }}>
            <Text className="text-emerald-400">Sign up</Text>
          </TouchableOpacity>
      </View>
    </View>
  )
}
