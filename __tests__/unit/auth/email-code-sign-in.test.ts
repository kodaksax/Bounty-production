/**
 * The email-code helpers behind sign-up's "You already have a Bounty account"
 * screen and sign-in's "Email me a code". Covers the parts the screen tests
 * don't: analytics never carries the address, failure codes are groupable,
 * and the sign-up → sign-in handoff expires.
 */

const signInWithOtp = jest.fn();
const verifyOtp = jest.fn();
jest.mock('lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...a: unknown[]) => signInWithOtp(...a),
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
    },
  },
}));

const trackEvent = jest.fn();
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => trackEvent(...a) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const codes = require('../../../lib/auth/email-code-sign-in');

const EMAIL = 'poster@web.test';

describe('email-code sign-in helpers', () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
    trackEvent.mockClear();
    codes.clearEmailCodeHandoff();
  });

  afterEach(() => {
    expect(JSON.stringify(trackEvent.mock.calls)).not.toContain(EMAIL);
  });

  it('never lets a code request create an account', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await codes.requestEmailSignInCode(EMAIL, 'sign_in_form');
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: EMAIL,
      options: { shouldCreateUser: false },
    });
  });

  it('reports a rejected send with its Supabase error code and rethrows', async () => {
    const err = { message: 'Signups not allowed for otp', status: 422, code: 'otp_disabled' };
    signInWithOtp.mockResolvedValue({ error: err });

    await expect(codes.requestEmailSignInCode(EMAIL, 'signup_existing_account')).rejects.toBe(err);
    expect(trackEvent).toHaveBeenCalledWith('auth_otp_failed', {
      method: 'email_otp',
      source: 'signup_existing_account',
      stage: 'send',
      is_resend: false,
      error_code: 'otp_disabled',
    });
    expect(trackEvent).not.toHaveBeenCalledWith('auth_otp_sent', expect.anything());
  });

  it('marks a non-web account as account_origin other', async () => {
    verifyOtp.mockResolvedValue({
      data: { session: { user: { id: 'u1', user_metadata: {} } } },
      error: null,
    });
    await codes.verifyEmailSignInCode(EMAIL, '123456', 'sign_in_form');
    expect(trackEvent).toHaveBeenCalledWith('auth_otp_verified', {
      method: 'email_otp',
      source: 'sign_in_form',
      account_origin: 'other',
    });
  });

  it('treats a verify with no session as a failure', async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(codes.verifyEmailSignInCode(EMAIL, '123456', 'sign_in_form')).rejects.toThrow(
      /No session was returned/
    );
    expect(trackEvent).toHaveBeenCalledWith(
      'auth_otp_failed',
      expect.objectContaining({ stage: 'verify', error_code: 'session_missing_after_otp' })
    );
    expect(trackEvent).not.toHaveBeenCalledWith('auth_otp_verified', expect.anything());
  });

  it('reports an expired or wrong code with its status when there is no code', async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: 'Token has expired or is invalid', status: 403 },
    });
    await expect(codes.verifyEmailSignInCode(EMAIL, '000000', 'sign_in_form')).rejects.toBeTruthy();
    expect(trackEvent).toHaveBeenCalledWith(
      'auth_otp_failed',
      expect.objectContaining({ stage: 'verify', error_code: 'http_403' })
    );
  });

  it('turns Supabase\'s "after N seconds" throttle into an exact wait', () => {
    expect(
      codes.emailCodeWaitMessage({
        message: 'For security purposes, you can only request this after 37 seconds.',
      })
    ).toBe('We just sent a code. You can ask for another in 37 seconds.');
    expect(codes.emailCodeWaitMessage({ message: 'Invalid email' })).toBeNull();
    expect(codes.emailCodeWaitMessage(null)).toBeNull();
  });

  it('keeps the handoff readable until it is cleared, and drops it once stale', () => {
    const now = Date.now();
    codes.setEmailCodeHandoff({ email: EMAIL, source: 'signup_existing_account' });

    // Readable more than once (React StrictMode runs state initializers twice).
    expect(codes.peekEmailCodeHandoff(now)).toEqual(
      expect.objectContaining({ email: EMAIL, source: 'signup_existing_account' })
    );
    expect(codes.peekEmailCodeHandoff(now)).not.toBeNull();

    expect(codes.peekEmailCodeHandoff(now + 31 * 60 * 1000)).toBeNull();
    expect(codes.peekEmailCodeHandoff(now)).toBeNull();

    codes.setEmailCodeHandoff({ email: EMAIL, source: 'signup_existing_account' });
    codes.clearEmailCodeHandoff();
    expect(codes.peekEmailCodeHandoff()).toBeNull();
  });

  it('accepts 6–10 digit codes only', () => {
    expect(codes.EMAIL_CODE_PATTERN.test('123456')).toBe(true);
    expect(codes.EMAIL_CODE_PATTERN.test('12345678')).toBe(true);
    expect(codes.EMAIL_CODE_PATTERN.test('12345')).toBe(false);
    expect(codes.EMAIL_CODE_PATTERN.test('12345a')).toBe(false);
  });
});
