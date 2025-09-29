"use client"

import React from "react"
import { Text, View } from "react-native"

import { MaterialIcons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import { Alert, AlertDescription } from "components/ui/alert"
import { Button } from "components/ui/button"
import { Input } from "components/ui/input"
import { Label } from "components/ui/label"
import { useState } from "react"
import { API_CONFIG } from "lib/config/app-config"

export function SignUpForm(): React.ReactElement {
  const navigation = useNavigation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [errors, setErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    setErrors({})
    setAuthError(null)
    setSuccess(false)

    // Basic frontend validation
    if (!email || !password || !username) {
      setErrors({ general: "All fields are required." })
      return
    }

    try {
      setIsLoading(true)

      const response = await fetch(`${API_CONFIG.authUrl}/auth/sign-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, username }),
      })

      const data = await response.json()

      if (!response.ok) {
        setAuthError(data.message || "Failed to create account.")
        return
      }

      // --- Sign-Up Success ---
      // Your backend will determine if email confirmation is needed.
      // This example assumes it is.
      if (data.requiresConfirmation) {
        setSuccess(true)
      }
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

  if (success) {
    return (
      <View style={{ gap: 12 }}>
        <Alert>
          <AlertDescription>
            Check your email for a confirmation link. You'll need to confirm your email before signing in.
          </AlertDescription>
        </Alert>
        <Button onPress={() => (navigation as any).navigate("SignIn")} className="w-full">
          Go to Sign In
        </Button>
      </View>
    )
  }

  return (
    <View style={{ gap: 12 }}>
      {authError && (
        <Alert variant="destructive">
          <AlertDescription>{authError}</AlertDescription>
        </Alert>
      )}

      <View>
        <Label>Email</Label>
        <Input
          value={email}
          onChangeText={(text: string) => setEmail(text)}
          placeholder="you@example.com"
          editable={!isLoading}
        />
        {getFieldError("email") && <Text style={{ color: "#ef4444", fontSize: 12 }}>{getFieldError("email")}</Text>}
      </View>

      <View>
        <Label>Username</Label>
        <Input
          value={username}
          onChangeText={(text: string) => setUsername(text)}
          placeholder="@username"
          editable={!isLoading}
        />
        {getFieldError("username") && <Text style={{ color: "#ef4444", fontSize: 12 }}>{getFieldError("username")}</Text>}
      </View>

      <View>
        <Label>Password</Label>
        <Input
          value={password}
          onChangeText={(text: string) => setPassword(text)}
          placeholder="Password"
          secureTextEntry
          editable={!isLoading}
        />
        {getFieldError("password") && <Text style={{ color: "#ef4444", fontSize: 12 }}>{getFieldError("password")}</Text>}
      </View>

      <Button onPress={handleSubmit} className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <MaterialIcons name="hourglass-top" size={16} style={{ marginRight: 8 }} />
            Creating account...
          </>
        ) : (
          "Sign Up"
        )}
      </Button>

      <Text style={{ textAlign: "center", fontSize: 14 }}>
        Already have an account?{' '}
        <Button variant="link" className="p-0 h-auto" onPress={() => (navigation as any).navigate('SignIn')}>
          Sign in
        </Button>
      </Text>
    </View>
  )
}
