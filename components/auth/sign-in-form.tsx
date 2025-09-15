"use client"

import type React from "react"
import { View, Text, TouchableOpacity } from "react-native"

import { Alert, AlertDescription } from "components/ui/alert"
import { Button } from "components/ui/button"
import { Input } from "components/ui/input"
import { Label } from "components/ui/label"
import { MaterialIcons } from "@expo/vector-icons"
import { useRouter } from "next/navigation"
import { useState } from "react"

export function SignInForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
      const response = await fetch("https://your-hostinger-api.com/auth/sign-in", {
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

      router.push("/dashboard")
      router.refresh()
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {authError && (
        <Alert variant="destructive">
          <AlertDescription>{authError}</AlertDescription>
        </Alert>
      )}

      <View className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={!!getFieldError("email")}
          disabled={isLoading}
        />
        {getFieldError("email") && <Text className="text-sm text-red-500">{getFieldError("email")}</Text>}
      </View>

      <View className="space-y-2">
        <View className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Button
            variant="link"
            className="p-0 h-auto text-xs"
            onPress={() => router.push("/reset-password")}
            type="button"
          >
            Forgot password?
          </Button>
        </View>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!getFieldError("password")}
          disabled={isLoading}
        />
        {getFieldError("password") && <Text className="text-sm text-red-500">{getFieldError("password")}</Text>}
      </View>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Signing in...
          </>
        ) : (
          "Sign In"
        )}
      </Button>

      <Text className="text-center text-sm">
        Don't have an account?{" "}
        <Button variant="link" className="p-0 h-auto" onPress={() => router.push("/sign-up")} type="button">
          Sign up
        </Button>
      </Text>
    </form>
  )
}
