export const ValidationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  // at least 8 chars, one upper, one lower, one number
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
  // strong: at least 8 chars, one upper, one lower, one number, one special character
  strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/,
}

export function isEmailValid(email: string): boolean {
  return ValidationPatterns.email.test(email.trim())
}

export function isPasswordValid(password: string): boolean {
  return ValidationPatterns.password.test(password)
}

export function isStrongPasswordValid(password: string): boolean {
  return ValidationPatterns.strongPassword.test(password)
}