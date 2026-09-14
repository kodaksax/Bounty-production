/**
 * Regression coverage for the Android "Continue with Google does nothing" P0.
 *
 * Production telemetry showed Android users firing
 * `onboarding_auth_started { method: 'google' }` two and three times in a row
 * with ZERO downstream events — no AUTH_ATTEMPT_STARTED, no AUTH_ATTEMPT_FAILED,
 * no error — before falling back to email or abandoning signup entirely.
 *
 * The cause was in the response handler: only `type === 'error'` produced a
 * message or an event, so the `dismiss` / `cancel` / `locked` outcomes (which
 * is what a Google client that rejects the request looks like from JS) returned
 * silently. The prompt call itself was also fire-and-forget, so a throw became
 * an unhandled rejection and left the button spinning.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

let googleResponse: unknown = null;
const promptAsync = jest.fn();

jest.mock('expo-auth-session', () => ({ ResponseType: { IdToken: 'id_token' } }));
jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: () => [{ url: 'https://accounts.google.com' }, googleResponse, promptAsync],
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('lib/supabase', () => ({
  supabase: { auth: { signInWithIdToken: jest.fn() } },
}));
jest.mock('lib/utils/auth-diagnostics', () => ({
  runAuthStageWithTimeout: ({ run }: { run: (s: AbortSignal) => PromiseLike<unknown> }) =>
    Promise.resolve(run(new AbortController().signal)),
}));

const capture = jest.fn();
jest.mock('lib/posthog', () => ({ capture: (...a: unknown[]) => capture(...a) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useSocialAuth } = require('../../../hooks/useSocialAuth');

function capturedEvents(name: string) {
  return capture.mock.calls.filter(([event]) => event === name).map(([, props]) => props);
}

describe('Google sign-in prompt is never a silent no-op', () => {
  beforeEach(() => {
    googleResponse = null;
    capture.mockClear();
    promptAsync.mockReset();
    promptAsync.mockResolvedValue(undefined);
  });

  it.each(['dismiss', 'locked'] as const)(
    'surfaces an error and an event when the prompt returns "%s"',
    async type => {
      googleResponse = { type };

      const { result } = renderHook(() => useSocialAuth());

      await waitFor(() => expect(result.current.error).toBeTruthy());

      // The user must be told something actionable, not left guessing.
      expect(result.current.error).toMatch(/Google sign-in|already open/i);
      expect(result.current.loading).toBe(false);

      const failures = capturedEvents('AUTH_ATTEMPT_FAILED');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        method: 'google',
        failure_stage: 'google_prompt',
        error_code: `google_prompt_${type}`,
      });
    }
  );

  it('records an explicit user cancellation without showing an error banner', async () => {
    googleResponse = { type: 'cancel' };

    const { result } = renderHook(() => useSocialAuth());

    await waitFor(() => expect(capturedEvents('AUTH_ATTEMPT_FAILED')).toHaveLength(1));

    // Cancelling is a choice, not a fault — measurable, but no scary banner.
    expect(result.current.error).toBeNull();
    expect(capturedEvents('AUTH_ATTEMPT_FAILED')[0]).toMatchObject({
      method: 'google',
      outcome: 'cancelled',
    });
  });

  it('emits AUTH_ATTEMPT_STARTED at the prompt boundary so the funnel sees the tap', async () => {
    const { result } = renderHook(() => useSocialAuth());

    await act(async () => {
      await result.current.promptGoogleSignIn();
    });

    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(capturedEvents('AUTH_ATTEMPT_STARTED')).toEqual([
      expect.objectContaining({ method: 'google', stage: 'google_prompt' }),
    ]);
  });

  it('reports a throwing prompt instead of leaving the button spinning', async () => {
    const boom: Error & { code?: string } = new Error('native module unavailable');
    boom.code = 'ERR_UNAVAILABLE';
    promptAsync.mockRejectedValue(boom);

    const { result } = renderHook(() => useSocialAuth());

    await act(async () => {
      await result.current.promptGoogleSignIn();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(capturedEvents('AUTH_ATTEMPT_FAILED')[0]).toMatchObject({
      method: 'google',
      error_code: 'ERR_UNAVAILABLE',
      failure_stage: 'google_prompt',
    });
  });
});
