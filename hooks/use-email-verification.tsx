/**
 * Email Verification Hook
 * Provides email verification status and utilities
 */

import { useAuth } from '../providers/auth-provider';
import { checkEmailVerified } from '../lib/services/auth-service';
import { useEffect, useState } from 'react';

export interface UseEmailVerificationResult {
  isEmailVerified: boolean;
  isLoading: boolean;
  canPostBounties: boolean;
  canWithdrawFunds: boolean;
  userEmail?: string;
  refreshVerificationStatus: () => Promise<void>;
}

/**
 * Hook to check if the current user's email is verified
 * and provide related permissions
 */
export function useEmailVerification(): UseEmailVerificationResult {
  const { session, isEmailVerified: authEmailVerified } = useAuth();
  const [isChecking, setIsChecking] = useState(false);
  const [localVerified, setLocalVerified] = useState(authEmailVerified);

  useEffect(() => {
    setLocalVerified(authEmailVerified);
  }, [authEmailVerified]);

  const refreshVerificationStatus = async () => {
    if (!session) return;
    
    setIsChecking(true);
    const verified = await checkEmailVerified();
    setLocalVerified(verified);
    setIsChecking(false);
  };

  return {
    isEmailVerified: localVerified,
    isLoading: isChecking,
    canPostBounties: localVerified,
    canWithdrawFunds: localVerified,
    userEmail: session?.user?.email,
    refreshVerificationStatus,
  };
}
