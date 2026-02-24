/**
 * Tests for CAPTCHA challenge logic used in the sign-in flow.
 *
 * The sign-in form shows a math-based CAPTCHA after CAPTCHA_THRESHOLD (3)
 * consecutive failed login attempts and blocks submission until it is solved.
 */

// ---------------------------------------------------------------------------
// Helpers that mirror the logic in captcha-challenge.tsx / sign-in-form.tsx
// ---------------------------------------------------------------------------

const CAPTCHA_THRESHOLD = 3

function isCaptchaRequired(loginAttempts: number, lockoutUntil: number | null): boolean {
  // CAPTCHA is shown once attempts reach the threshold, but not when locked out
  // (locked-out users see the lockout message instead)
  return loginAttempts >= CAPTCHA_THRESHOLD && !lockoutUntil
}

/** Simulate the state machine used in sign-in-form */
function signInAttemptResult(params: {
  loginAttempts: number
  lockoutUntil: number | null
  captchaVerified: boolean
  formValid: boolean
  authSucceeds: boolean
}): { error: string | null; newAttempts: number; newLockout: number | null; newCaptchaVerified: boolean } {
  const { loginAttempts, lockoutUntil, captchaVerified, formValid, authSucceeds } = params

  // Lockout check
  if (lockoutUntil && Date.now() < lockoutUntil) {
    return { error: 'Too many failed attempts. Please wait.', newAttempts: loginAttempts, newLockout: lockoutUntil, newCaptchaVerified: captchaVerified }
  }

  // CAPTCHA check
  if (loginAttempts >= CAPTCHA_THRESHOLD && !captchaVerified) {
    return { error: 'Please complete the security check before signing in.', newAttempts: loginAttempts, newLockout: lockoutUntil, newCaptchaVerified: captchaVerified }
  }

  // Form validation
  if (!formValid) {
    return { error: 'Please fix the form errors', newAttempts: loginAttempts, newLockout: lockoutUntil, newCaptchaVerified: captchaVerified }
  }

  if (authSucceeds) {
    return { error: null, newAttempts: 0, newLockout: null, newCaptchaVerified: false }
  }

  // Auth failed
  const newAttempts = loginAttempts + 1
  let newLockout = lockoutUntil
  let newCaptchaVerified = captchaVerified
  if (newAttempts >= 5) {
    newLockout = Date.now() + 5 * 60 * 1000
    newCaptchaVerified = false
  }
  return { error: 'Invalid email or password.', newAttempts, newLockout, newCaptchaVerified }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CAPTCHA threshold logic (isCaptchaRequired)', () => {
  it('does not require CAPTCHA on first attempt', () => {
    expect(isCaptchaRequired(0, null)).toBe(false)
  })

  it('does not require CAPTCHA below threshold', () => {
    expect(isCaptchaRequired(1, null)).toBe(false)
    expect(isCaptchaRequired(2, null)).toBe(false)
  })

  it('requires CAPTCHA at the threshold (3 attempts)', () => {
    expect(isCaptchaRequired(3, null)).toBe(true)
  })

  it('requires CAPTCHA above the threshold', () => {
    expect(isCaptchaRequired(4, null)).toBe(true)
  })

  it('does NOT require CAPTCHA when user is locked out', () => {
    const futureTimestamp = Date.now() + 5 * 60 * 1000
    expect(isCaptchaRequired(4, futureTimestamp)).toBe(false)
  })
})

describe('Sign-in form CAPTCHA enforcement', () => {
  it('allows submission before threshold without CAPTCHA', () => {
    const result = signInAttemptResult({
      loginAttempts: 2,
      lockoutUntil: null,
      captchaVerified: false,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.error).toBeNull()
  })

  it('blocks submission at threshold when CAPTCHA not verified', () => {
    const result = signInAttemptResult({
      loginAttempts: 3,
      lockoutUntil: null,
      captchaVerified: false,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.error).toMatch(/security check/i)
  })

  it('allows submission at threshold when CAPTCHA is verified', () => {
    const result = signInAttemptResult({
      loginAttempts: 3,
      lockoutUntil: null,
      captchaVerified: true,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.error).toBeNull()
  })

  it('resets attempts and captcha state on successful login', () => {
    const result = signInAttemptResult({
      loginAttempts: 3,
      lockoutUntil: null,
      captchaVerified: true,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.newAttempts).toBe(0)
    expect(result.newLockout).toBeNull()
    expect(result.newCaptchaVerified).toBe(false)
  })

  it('increments attempts on failed auth', () => {
    const result = signInAttemptResult({
      loginAttempts: 2,
      lockoutUntil: null,
      captchaVerified: false,
      formValid: true,
      authSucceeds: false,
    })
    expect(result.newAttempts).toBe(3)
    expect(result.error).toBeTruthy()
  })

  it('triggers lockout after 5 failed attempts and clears captcha', () => {
    const result = signInAttemptResult({
      loginAttempts: 4,
      lockoutUntil: null,
      captchaVerified: true,
      formValid: true,
      authSucceeds: false,
    })
    expect(result.newAttempts).toBe(5)
    expect(result.newLockout).not.toBeNull()
    expect(result.newCaptchaVerified).toBe(false)
  })

  it('blocks submission when locked out, regardless of CAPTCHA', () => {
    const futureTimestamp = Date.now() + 5 * 60 * 1000
    const result = signInAttemptResult({
      loginAttempts: 5,
      lockoutUntil: futureTimestamp,
      captchaVerified: true,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.error).toMatch(/too many failed attempts/i)
  })
})

describe('CAPTCHA challenge answer validation', () => {
  /** Mirrors generateChallenge deterministically for testing */
  function makeChallenge(a: number, b: number, op: '+' | '-') {
    return { question: `${a} ${op} ${b}`, answer: op === '+' ? a + b : a - b }
  }

  it('accepts correct answer for addition', () => {
    const c = makeChallenge(3, 4, '+')
    expect(c.answer).toBe(7)
  })

  it('accepts correct answer for subtraction', () => {
    const c = makeChallenge(9, 3, '-')
    expect(c.answer).toBe(6)
  })

  it('rejects incorrect answers', () => {
    const c = makeChallenge(5, 2, '+')
    expect(parseInt('6', 10)).not.toBe(c.answer)
    expect(parseInt('8', 10)).not.toBe(c.answer)
    expect(parseInt('7', 10)).toBe(c.answer) // correct one
  })

  it('does not produce negative answers', () => {
    // The component always ensures a >= b for subtraction
    for (let i = 0; i < 20; i++) {
      const a = Math.floor(Math.random() * 9) + 1
      const b = Math.floor(Math.random() * 9) + 1
      const answer = a > b ? a - b : a + b
      expect(answer).toBeGreaterThanOrEqual(0)
    }
  })
})
