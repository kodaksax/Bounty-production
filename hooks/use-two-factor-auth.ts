/**
 * Two-Factor Authentication Hook
 *
 * Manages TOTP 2FA enrollment status, MFA challenge detection, and high-value
 * account prompting via Supabase MFA APIs.
 *
 * High-value account threshold: accounts with a wallet balance >= $100 USD
 * (stored as cents: 10000) are encouraged to enable 2FA.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Wallet balance threshold (in cents) above which 2FA is strongly recommended. */
export const HIGH_VALUE_ACCOUNT_THRESHOLD_CENTS = 10_000; // $100.00

export interface TwoFactorAuthState {
  /** Whether a TOTP factor is enrolled and verified for this account. */
  isEnrolled: boolean;
  /** Whether an MFA challenge is currently required (AAL1 → AAL2 upgrade needed). */
  isMfaChallengeRequired: boolean;
  /** Whether the account qualifies as "high-value" and should be prompted to enroll. */
  isHighValueAccount: boolean;
  /** Whether initial status is still loading. */
  isLoading: boolean;
  /** ID of the first enrolled TOTP factor, or null if none. */
  factorId: string | null;
  /** Reload enrollment status from Supabase. */
  refresh: () => Promise<void>;
  /** Enroll a new TOTP factor. Returns the enrollment data (id + totp). */
  enroll: () => Promise<{ id: string; totp: { secret: string; uri: string; qr_code?: string } } | null>;
  /** Verify a code against an in-progress enrollment and activate 2FA. */
  verifyEnrollment: (factorId: string, code: string) => Promise<{ success: boolean; error?: string }>;
  /** Complete an MFA challenge with a TOTP code to elevate to AAL2. */
  challengeAndVerify: (code: string) => Promise<{ success: boolean; error?: string }>;
  /** Unenroll (disable) the active TOTP factor. */
  unenroll: () => Promise<{ success: boolean; error?: string }>;
}

/**
 * Hook that provides 2FA management for the currently signed-in user.
 *
 * @param walletBalanceCents - Current wallet balance in cents (used to determine high-value status).
 */
export function useTwoFactorAuth(walletBalanceCents: number = 0): TwoFactorAuthState {
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isMfaChallengeRequired, setIsMfaChallengeRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);

  const isHighValueAccount = walletBalanceCents >= HIGH_VALUE_ACCOUNT_THRESHOLD_CENTS;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      // Check enrolled factors
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactors = factors?.totp ?? [];
      // listFactors().totp only contains verified TOTP factors
      const firstFactor = totpFactors[0] ?? null;

      setIsEnrolled(totpFactors.length > 0);
      setFactorId(firstFactor?.id ?? null);

      // Check whether current session needs AAL2 upgrade
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      setIsMfaChallengeRequired(
        Boolean(aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2')
      );
    } catch (err) {
      console.error('[use-two-factor-auth] refresh error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enroll = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator App',
      });
      if (error) throw error;
      return data as { id: string; totp: { secret: string; uri: string; qr_code?: string } };
    } catch (err: any) {
      console.error('[use-two-factor-auth] enroll error:', err);
      return null;
    }
  }, []);

  const verifyEnrollment = useCallback(async (enrollFactorId: string, code: string) => {
    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollFactorId,
        code,
      });
      if (error) throw error;
      if (data) {
        setIsEnrolled(true);
        setFactorId(enrollFactorId);
        setIsMfaChallengeRequired(false);
      }
      return { success: true };
    } catch (err: any) {
      console.error('[use-two-factor-auth] verifyEnrollment error:', err);
      return { success: false, error: err?.message ?? 'Verification failed' };
    }
  }, []);

  const challengeAndVerify = useCallback(async (code: string) => {
    if (!factorId) {
      return { success: false, error: 'No enrolled factor found' };
    }
    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (error) throw error;
      if (data) {
        setIsMfaChallengeRequired(false);
      }
      return { success: true };
    } catch (err: any) {
      console.error('[use-two-factor-auth] challengeAndVerify error:', err);
      return { success: false, error: err?.message ?? 'Invalid code' };
    }
  }, [factorId]);

  const unenroll = useCallback(async () => {
    if (!factorId) {
      return { success: false, error: 'No enrolled factor found' };
    }
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      setIsEnrolled(false);
      setFactorId(null);
      return { success: true };
    } catch (err: any) {
      console.error('[use-two-factor-auth] unenroll error:', err);
      return { success: false, error: err?.message ?? 'Failed to disable 2FA' };
    }
  }, [factorId]);

  return {
    isEnrolled,
    isMfaChallengeRequired,
    isHighValueAccount,
    isLoading,
    factorId,
    refresh,
    enroll,
    verifyEnrollment,
    challengeAndVerify,
    unenroll,
  };
}
