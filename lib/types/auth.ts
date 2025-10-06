// lib/types/auth.ts - Authentication types for Supabase backend

/**
 * Response from sign-up endpoint
 * POST /app/auth/sign-up-form
 */
export interface SignUpResponse {
  success: boolean;
  message: string;
  userId?: string;
  requiresConfirmation?: boolean;
  error?: string;
}

/**
 * Response from sign-in endpoint
 * POST /app/auth/sign-in-form
 */
export interface SignInResponse {
  success: boolean;
  message: string;
  user?: {
    id: string;
    email: string;
    username: string;
  };
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    token_type?: string;
  };
  redirectTo?: string;
  error?: string;
}

/**
 * Request body for sign-up
 */
export interface SignUpRequest {
  email: string;
  username: string;
  password: string;
}

/**
 * Request body for sign-in
 */
export interface SignInRequest {
  email: string;
  password: string;
}

/**
 * Error response from auth endpoints
 */
export interface AuthErrorResponse {
  error: string;
  message?: string;
  details?: string;
}

/**
 * Validation error for form fields
 */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Auth state stored in SecureStore
 */
export interface AuthState {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  email: string;
  username?: string;
  expiresAt?: number;
}
