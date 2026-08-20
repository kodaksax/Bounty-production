/**
 * Integration tests for turning a parsed auth link into a Supabase session.
 *
 * These verify the actual Supabase call made for each link shape, and the
 * single-use semantics that make "the link was opened twice" a normal outcome
 * rather than an error.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: jest.fn(),
      verifyOtp: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      getSession: jest.fn(),
    },
  },
}));

import {
  consumeAuthLink,
  hasConsumedRecoveryLink,
  resetConsumedRecoveryLink,
} from '../../../lib/auth/consume-auth-link';
import type { ParsedAuthLink } from '../../../lib/auth/recovery-link';

const { supabase } = require('../../../lib/supabase');

const SESSION = { session: { access_token: 'at', refresh_token: 'rt' }, user: { id: 'u1' } };
const NO_SESSION = { session: null, user: null };

const TOKENS_LINK: ParsedAuthLink = {
  kind: 'tokens',
  accessToken: 'at-from-link',
  refreshToken: 'rt-from-link',
  type: 'recovery',
};

beforeEach(() => {
  jest.clearAllMocks();
  resetConsumedRecoveryLink();
  supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
});

describe('consumeAuthLink', () => {
  describe('successful establishment', () => {
    it('calls setSession with the fragment tokens', async () => {
      supabase.auth.setSession.mockResolvedValue({ data: SESSION, error: null });

      await expect(consumeAuthLink(TOKENS_LINK)).resolves.toEqual({
        status: 'established',
        type: 'recovery',
      });
      expect(supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: 'at-from-link',
        refresh_token: 'rt-from-link',
      });
    });

    it('calls verifyOtp with the token hash and its type', async () => {
      supabase.auth.verifyOtp.mockResolvedValue({ data: SESSION, error: null });

      await expect(
        consumeAuthLink({ kind: 'token_hash', tokenHash: 'h1', type: 'recovery' })
      ).resolves.toEqual({ status: 'established', type: 'recovery' });
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
        token_hash: 'h1',
        type: 'recovery',
      });
    });

    it('exchanges a PKCE code', async () => {
      supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: SESSION, error: null });

      await expect(
        consumeAuthLink({ kind: 'code', code: 'c1', type: 'recovery' })
      ).resolves.toEqual({ status: 'established', type: 'recovery' });
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('c1');
    });

    it('marks recovery as consumed, but not other link types', async () => {
      supabase.auth.setSession.mockResolvedValue({ data: SESSION, error: null });

      await consumeAuthLink({ ...TOKENS_LINK, type: 'signup' });
      expect(hasConsumedRecoveryLink()).toBe(false);

      await consumeAuthLink(TOKENS_LINK);
      expect(hasConsumedRecoveryLink()).toBe(true);
    });
  });

  describe('link already reported as failed', () => {
    it('maps an expired link to expired', async () => {
      await expect(
        consumeAuthLink({ kind: 'error', code: 'expired', type: 'recovery' })
      ).resolves.toEqual({ status: 'expired' });
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it('maps a used link to expired — same remedy', async () => {
      await expect(consumeAuthLink({ kind: 'error', code: 'used', type: null })).resolves.toEqual({
        status: 'expired',
      });
    });

    it('maps an invalid link to invalid', async () => {
      await expect(
        consumeAuthLink({ kind: 'error', code: 'invalid', type: null })
      ).resolves.toEqual({ status: 'invalid' });
    });

    it('maps an unknown error to a retryable failure', async () => {
      await expect(
        consumeAuthLink({ kind: 'error', code: 'unknown', type: null })
      ).resolves.toEqual({ status: 'failed' });
    });

    it('passes an empty link straight through', async () => {
      await expect(consumeAuthLink({ kind: 'none' })).resolves.toEqual({ status: 'none' });
    });
  });

  describe('the link opened twice', () => {
    it('reports already_established when this run spent the link and the session holds', async () => {
      supabase.auth.setSession.mockResolvedValue({ data: SESSION, error: null });
      await consumeAuthLink(TOKENS_LINK);

      // Second delivery: Supabase now reports the token as expired.
      supabase.auth.getSession.mockResolvedValue({
        data: { session: { access_token: 'at' } },
        error: null,
      });

      await expect(
        consumeAuthLink({ kind: 'error', code: 'expired', type: 'recovery' })
      ).resolves.toEqual({ status: 'already_established', type: 'recovery' });
    });

    it('still reports expired when no recovery link was consumed in this run', async () => {
      // An ordinary logged-in session must never make a stale recovery link
      // look successful.
      supabase.auth.getSession.mockResolvedValue({
        data: { session: { access_token: 'at' } },
        error: null,
      });

      await expect(
        consumeAuthLink({ kind: 'error', code: 'expired', type: 'recovery' })
      ).resolves.toEqual({ status: 'expired' });
    });

    it('reports already_established when a re-consume attempt errors but the session holds', async () => {
      supabase.auth.setSession.mockResolvedValueOnce({ data: SESSION, error: null });
      await consumeAuthLink(TOKENS_LINK);

      supabase.auth.setSession.mockResolvedValueOnce({
        data: NO_SESSION,
        error: { message: 'Token has expired or is invalid', status: 401 },
      });
      supabase.auth.getSession.mockResolvedValue({
        data: { session: { access_token: 'at' } },
        error: null,
      });

      await expect(consumeAuthLink(TOKENS_LINK)).resolves.toEqual({
        status: 'already_established',
        type: 'recovery',
      });
    });

    it('resetConsumedRecoveryLink clears the marker so a restart cannot resume recovery', async () => {
      supabase.auth.setSession.mockResolvedValue({ data: SESSION, error: null });
      await consumeAuthLink(TOKENS_LINK);
      expect(hasConsumedRecoveryLink()).toBe(true);

      resetConsumedRecoveryLink();
      expect(hasConsumedRecoveryLink()).toBe(false);
    });
  });

  describe('Supabase errors', () => {
    it('classifies an expired-token error as expired', async () => {
      supabase.auth.setSession.mockResolvedValue({
        data: NO_SESSION,
        error: { message: 'Token has expired' },
      });
      await expect(consumeAuthLink(TOKENS_LINK)).resolves.toEqual({ status: 'expired' });
    });

    it('classifies an invalid-token error as invalid', async () => {
      supabase.auth.verifyOtp.mockResolvedValue({
        data: NO_SESSION,
        error: { message: 'Invalid token hash', status: 401 },
      });
      await expect(
        consumeAuthLink({ kind: 'token_hash', tokenHash: 'bad', type: 'recovery' })
      ).resolves.toEqual({ status: 'invalid' });
    });

    it('classifies a rate limit as retryable rather than terminal', async () => {
      supabase.auth.setSession.mockResolvedValue({
        data: NO_SESSION,
        error: { message: 'Request rate limit reached', status: 429 },
      });
      await expect(consumeAuthLink(TOKENS_LINK)).resolves.toEqual({ status: 'failed' });
    });

    it('classifies a thrown network error as retryable', async () => {
      supabase.auth.setSession.mockRejectedValue(new Error('Network request failed'));
      await expect(consumeAuthLink(TOKENS_LINK)).resolves.toEqual({ status: 'failed' });
    });

    it('treats a no-error/no-session response as invalid rather than success', async () => {
      // Proceeding here would send the user to a form whose submit is
      // guaranteed to fail unauthenticated.
      supabase.auth.setSession.mockResolvedValue({ data: NO_SESSION, error: null });
      await expect(consumeAuthLink(TOKENS_LINK)).resolves.toEqual({ status: 'invalid' });
    });

    it('reports invalid when the client build has no PKCE support', async () => {
      const saved = supabase.auth.exchangeCodeForSession;
      supabase.auth.exchangeCodeForSession = undefined;
      try {
        await expect(
          consumeAuthLink({ kind: 'code', code: 'c1', type: 'recovery' })
        ).resolves.toEqual({ status: 'invalid' });
      } finally {
        supabase.auth.exchangeCodeForSession = saved;
      }
    });
  });

  it('never puts a token value in a rejection or result', async () => {
    supabase.auth.setSession.mockResolvedValue({
      data: NO_SESSION,
      error: { message: 'Token has expired' },
    });
    const outcome = await consumeAuthLink(TOKENS_LINK);
    expect(JSON.stringify(outcome)).not.toContain('at-from-link');
    expect(JSON.stringify(outcome)).not.toContain('rt-from-link');
  });
});
