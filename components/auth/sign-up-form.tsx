"use client"

import type React from "react"

import { Alert, AlertDescription } from "components/ui/alert"
import { Button } from "components/ui/button"
import { Input } from "components/ui/input"
import { Label } from "components/ui/label"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

export function SignUpForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [errors, setErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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

      // TODO: Replace with your Hostinger backend API endpoint
      const response = await fetch("https://your-hostinger-api.com/auth/sign-up", {
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
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Check your email for a confirmation link. You'll need to confirm your email before signing in.
          </AlertDescription>
        </Alert>
        <Button onClick={() => router.push("/sign-in")} className="w-full">
          Go to Sign In
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {authError && (
        <Alert variant="destructive">
          <AlertDescription>{authError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
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
        {getFieldError("email") && <p className="text-sm text-red-500">{getFieldError("email")}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="@username"
          aria-invalid={!!getFieldError("username")}
          disabled={isLoading}
        />
        {getFieldError("username") && <p className="text-sm text-red-500">{getFieldError("username")}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!getFieldError("password")}
          disabled={isLoading}
        />
        {getFieldError("password") && <p className="text-sm text-red-500">{getFieldError("password")}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating account...
          </>
        ) : (
          "Sign Up"
        )}
      </Button>

      <p className="text-center text-sm">
        Already have an account?{" "}
        <Button variant="link" className="p-0 h-auto" onClick={() => router.push("/sign-in")} type="button">
          Sign in
        </Button>
      </p>
    </form>
  )
}
