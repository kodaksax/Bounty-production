/**
 * Regression coverage for the "Cancel sign-in" button on the MFA challenge
 * screen (app/auth/mfa-challenge.tsx).
 *
 * That handler exists to guarantee one thing: the pre-MFA (AAL1) session
 * created by password sign-in must not be usable to reach the app without
 * completing the TOTP challenge. It signs out with `{ scope: 'local' }` so
 * it only touches THIS device (the SDK's `global` default would also kick
 * this user's already-verified sessions on their other devices).
 *
 * `scope: 'local'` performing the server-side revocation is what the
 * happy-path relies on — but supabase-js's `GoTrueClient._signOut()`
 * swallows a failed revocation call into a returned `{ error }` rather than
 * a thrown rejection, and on that path it also skips clearing local
 * storage. A plain `try { await signOut() } catch {}` around that call
 * therefore never fires its catch block on a network failure, and would
 * silently leave the un-revoked session sitting on this device's disk. The
 * handler must also wipe local session storage unconditionally so the
 * session can't be reused from this device even when the network
 * revocation call fails.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

const signOut = jest.fn().mockResolvedValue({ error: null });
jest.mock('lib/supabase', () => ({
  supabase: { auth: { signOut: (...a: unknown[]) => signOut(...a) } },
  PROJECT_STORAGE_KEY: 'test-project-storage-key',
}));

const clearAllSessionData = jest.fn().mockResolvedValue(undefined);
jest.mock('lib/auth-session-storage', () => ({
  clearAllSessionData: (...a: unknown[]) => clearAllSessionData(...a),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('hooks/use-two-factor-auth', () => ({
  useTwoFactorAuth: () => ({
    isMfaChallengeRequired: true,
    isEnrolled: true,
    isLoading: false,
    challengeAndVerify: jest.fn(),
  }),
}));

jest.mock('lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({
    theme: {
      background: '#000',
      text: '#fff',
      textSecondary: '#ccc',
      surfaceSecondary: '#111',
      isDark: true,
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('app/initial-navigation/initialNavigation', () => ({
  markInitialNavigationDone: jest.fn(),
}));

import MfaChallengeScreen from '../../../app/auth/mfa-challenge';

describe('MFA challenge screen — Cancel sign-in', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signOut.mockResolvedValue({ error: null });
    clearAllSessionData.mockResolvedValue(undefined);
  });

  const pressCancel = async () => {
    const { getByLabelText } = render(<MfaChallengeScreen />);
    fireEvent.press(getByLabelText('Cancel sign-in'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  };

  it('signs out device-local only, not the SDK global default', async () => {
    await pressCancel();

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('wipes local session storage even when the network sign-out call fails', async () => {
    signOut.mockRejectedValue(new Error('network request failed'));

    await pressCancel();

    // The pre-MFA session must not survive on this device's disk just
    // because the server-side revocation request didn't go through.
    expect(clearAllSessionData).toHaveBeenCalledWith('test-project-storage-key');
  });

  it('wipes local session storage on the happy path too', async () => {
    await pressCancel();

    expect(clearAllSessionData).toHaveBeenCalledWith('test-project-storage-key');
  });

  it('still navigates to sign-in when cleanup fails', async () => {
    signOut.mockRejectedValue(new Error('network request failed'));
    clearAllSessionData.mockRejectedValue(new Error('storage error'));

    await pressCancel();

    expect(mockReplace).toHaveBeenCalledWith('/auth/sign-in-form');
  });
});
