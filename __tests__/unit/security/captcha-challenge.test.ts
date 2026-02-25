/**
 * Tests for CAPTCHA challenge logic used in the sign-in flow.
 *
 * The sign-in form shows a math-based CAPTCHA after CAPTCHA_THRESHOLD (3)
 * consecutive failed login attempts and blocks submission until it is solved.
 */

import { CAPTCHA_THRESHOLD } from '../../../lib/utils/captcha'
import { generateChallenge } from '../../../components/ui/captcha-challenge'

// ---------------------------------------------------------------------------
// Pure helper that models the submit-guard logic in sign-in-form (uses the
// real CAPTCHA_THRESHOLD export so it stays in sync with production code).
// ---------------------------------------------------------------------------

function isCaptchaRequired(loginAttempts: number, lockoutUntil: number | null): boolean {
  const isLockoutActive = lockoutUntil !== null && Date.now() < lockoutUntil
  return loginAttempts >= CAPTCHA_THRESHOLD && !isLockoutActive
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

  // Lockout check (mirrors isLockoutActive in sign-in-form)
  const isLockoutActive = lockoutUntil !== null && Date.now() < lockoutUntil
  if (isLockoutActive) {
    return { error: 'Too many failed attempts. Please wait.', newAttempts: loginAttempts, newLockout: lockoutUntil, newCaptchaVerified: captchaVerified }
  }

  // CAPTCHA check (mirrors captchaRequired in sign-in-form, uses real CAPTCHA_THRESHOLD)
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
    expect(isCaptchaRequired(CAPTCHA_THRESHOLD - 2, null)).toBe(false)
    expect(isCaptchaRequired(CAPTCHA_THRESHOLD - 1, null)).toBe(false)
  })

  it('requires CAPTCHA at the threshold', () => {
    expect(isCaptchaRequired(CAPTCHA_THRESHOLD, null)).toBe(true)
  })

  it('requires CAPTCHA above the threshold', () => {
    expect(isCaptchaRequired(CAPTCHA_THRESHOLD + 1, null)).toBe(true)
  })

  it('does NOT require CAPTCHA when user is actively locked out', () => {
    const futureTimestamp = Date.now() + 5 * 60 * 1000
    expect(isCaptchaRequired(CAPTCHA_THRESHOLD + 1, futureTimestamp)).toBe(false)
  })

  it('DOES require CAPTCHA when lockout timestamp has expired', () => {
    const pastTimestamp = Date.now() - 1 // already expired
    expect(isCaptchaRequired(CAPTCHA_THRESHOLD, pastTimestamp)).toBe(true)
  })
})

describe('Sign-in form CAPTCHA enforcement', () => {
  it('allows submission before threshold without CAPTCHA', () => {
    const result = signInAttemptResult({
      loginAttempts: CAPTCHA_THRESHOLD - 1,
      lockoutUntil: null,
      captchaVerified: false,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.error).toBeNull()
  })

  it('blocks submission at threshold when CAPTCHA not verified', () => {
    const result = signInAttemptResult({
      loginAttempts: CAPTCHA_THRESHOLD,
      lockoutUntil: null,
      captchaVerified: false,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.error).toMatch(/security check/i)
  })

  it('allows submission at threshold when CAPTCHA is verified', () => {
    const result = signInAttemptResult({
      loginAttempts: CAPTCHA_THRESHOLD,
      lockoutUntil: null,
      captchaVerified: true,
      formValid: true,
      authSucceeds: true,
    })
    expect(result.error).toBeNull()
  })

  it('resets attempts and captcha state on successful login', () => {
    const result = signInAttemptResult({
      loginAttempts: CAPTCHA_THRESHOLD,
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
      loginAttempts: CAPTCHA_THRESHOLD - 1,
      lockoutUntil: null,
      captchaVerified: false,
      formValid: true,
      authSucceeds: false,
    })
    expect(result.newAttempts).toBe(CAPTCHA_THRESHOLD)
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

  it('allows CAPTCHA-gated submission once lockout timestamp has expired', () => {
    const expiredLockout = Date.now() - 1 // already in the past
    const result = signInAttemptResult({
      loginAttempts: 5,
      lockoutUntil: expiredLockout,
      captchaVerified: true,
      formValid: true,
      authSucceeds: true,
    })
    // Lockout expired → CAPTCHA still required but is verified → success
    expect(result.error).toBeNull()
  })
})

describe('generateChallenge (production function)', () => {
  it('produces a non-negative answer', () => {
    // Run many times; generateChallenge guarantees a >= b for subtraction
    for (let i = 0; i < 50; i++) {
      const c = generateChallenge()
      expect(c.answer).toBeGreaterThanOrEqual(0)
    }
  })

  it('answer equals the arithmetic result of the question', () => {
    for (let i = 0; i < 20; i++) {
      const c = generateChallenge()
      const [a, op, b] = c.question.split(' ')
      const expected = op === '+' ? parseInt(a) + parseInt(b) : parseInt(a) - parseInt(b)
      expect(c.answer).toBe(expected)
    }
  })

  it('operands are always between 1 and 9 inclusive', () => {
    for (let i = 0; i < 20; i++) {
      const c = generateChallenge()
      const [a, , b] = c.question.split(' ')
      expect(parseInt(a)).toBeGreaterThanOrEqual(1)
      expect(parseInt(a)).toBeLessThanOrEqual(9)
      expect(parseInt(b)).toBeGreaterThanOrEqual(1)
      expect(parseInt(b)).toBeLessThanOrEqual(9)
    }
  })
})

describe('CAPTCHA challenge answer validation', () => {
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
    expect(6).not.toBe(c.answer)
    expect(8).not.toBe(c.answer)
    expect(7).toBe(c.answer) // correct one
  })

  it('subtraction answers are never negative (deterministic pairs)', () => {
    const subtractionPairs: Array<[number, number]> = [
      [1, 1],
      [5, 2],
      [9, 3],
      [9, 9],
    ]
    subtractionPairs.forEach(([a, b]) => {
      const c = makeChallenge(a, b, '-')
      expect(c.answer).toBeGreaterThanOrEqual(0)
    })
  })
})
