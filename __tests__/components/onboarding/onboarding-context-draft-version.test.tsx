/**
 * The persisted onboarding draft is versioned (lib/context/onboarding-context.tsx).
 *
 * The regression this guards: bumping CURRENT_ONBOARDING_VERSION used to
 * invalidate nothing, so a v1 draft with `intent` set was resumed under v2 and
 * app/onboarding/index.tsx routed that user straight to payouts — skipping the
 * style, location and role steps that v2 added ahead of it.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { user: { id: 'user-1' } } }),
}));

import {
  CURRENT_ONBOARDING_VERSION,
  OnboardingProvider,
  useOnboarding,
} from '../../../lib/context/onboarding-context';

const KEY = '@bounty_onboarding_state:user-1';
const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

function stubStored(value: string | null) {
  mockGetItem.mockImplementation(async (key: string) => (key === KEY ? value : null));
}

function renderOnboarding() {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <OnboardingProvider>{children}</OnboardingProvider>
  );
  return renderHook(() => useOnboarding(), { wrapper });
}

describe('onboarding draft versioning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('discards an unversioned v1 draft instead of resuming its intent', async () => {
    stubStored(JSON.stringify({ intent: 'poster', location: '12 Main St' }));

    const { result } = renderOnboarding();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data.intent).toBeNull();
    expect(result.current.data.location).toBe('');
    expect(mockRemoveItem).toHaveBeenCalledWith(KEY);
  });

  it('discards a draft written under a different version', async () => {
    stubStored(JSON.stringify({ version: CURRENT_ONBOARDING_VERSION - 1, data: { intent: 'hunter' } }));

    const { result } = renderOnboarding();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data.intent).toBeNull();
    expect(mockRemoveItem).toHaveBeenCalledWith(KEY);
  });

  it('resumes a draft written under the current version', async () => {
    stubStored(JSON.stringify({ version: CURRENT_ONBOARDING_VERSION, data: { intent: 'hunter' } }));

    const { result } = renderOnboarding();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data.intent).toBe('hunter');
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('persists drafts in the versioned envelope', async () => {
    stubStored(null);

    const { result } = renderOnboarding();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await waitFor(() => expect(mockSetItem).toHaveBeenCalled());
    const [key, value] = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
    expect(key).toBe(KEY);
    expect(JSON.parse(value)).toMatchObject({ version: CURRENT_ONBOARDING_VERSION });
  });
});
