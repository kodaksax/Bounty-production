/**
 * SBA-10 (1): after publishing, the poster is told how this goes — when
 * applications arrive, that they choose, when they pay, and that unanswered
 * applications close on their own. The window comes from
 * posting_policy_config.request_expiry_hours, the value
 * fn_expire_bounty_requests uses.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';
import { darkTheme } from '../../lib/themes/darkTheme';
import { lightTheme } from '../../lib/themes/lightTheme';

let mockTheme: any = lightTheme;
jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({ theme: mockTheme }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockMaybeSingle = jest.fn();
jest.mock('lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({ maybeSingle: mockMaybeSingle })),
    })),
  },
}));

import { __resetRequestExpiryPolicyCache } from '../../hooks/useRequestExpiryPolicy';
import { StepPostPublish } from '../../app/screens/CreateBounty/quick/StepPostPublish';

const baseDraft: any = {
  title: 'Assemble a bookshelf',
  description: 'Flat-pack, two shelves, tools provided.',
  amount: 40,
  isForHonor: false,
  category: 'handyman',
  workType: 'in_person',
  location: 'Austin, TX',
  scheduleType: 'asap',
  attachments: [],
};

function renderStep(overrides: Record<string, unknown> = {}, funded?: boolean) {
  return render(
    <StepPostPublish
      draft={{ ...baseDraft, ...overrides }}
      onAddDetail={jest.fn()}
      onContinue={jest.fn()}
      funded={funded}
      step={4}
      totalSteps={4}
    />
  );
}

/** Merges a style prop (object or nested arrays) the way React Native does. */
function flat(style: any): Record<string, any> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return style || {};
}

function card() {
  return within(screen.getByTestId('post-publish-what-next'));
}

beforeEach(() => {
  __resetRequestExpiryPolicyCache();
  mockTheme = lightTheme;
  mockMaybeSingle.mockResolvedValue({
    data: { request_expiry_hours: 72, request_interacted_expiry_hours: 168 },
    error: null,
  });
});

describe('StepPostPublish — What happens next', () => {
  it('covers arrival, choosing, pay-at-hire, and the 3-day close', async () => {
    renderStep();
    expect(screen.getByText('What happens next')).toBeTruthy();
    expect(card().getByText(/usually apply within a few hours/)).toBeTruthy();
    expect(card().getByText(/You choose who to hire/)).toBeTruthy();
    // Same promise StepPay made: charged at hire, held, released on approval.
    expect(
      card().getByText(
        "You're only charged when you hire. $40 is held then, and released when you approve the work."
      )
    ).toBeTruthy();
    expect(
      card().getByText("If you don't answer an application within 3 days, it closes automatically.")
    ).toBeTruthy();
  });

  it('takes the window from posting_policy_config', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { request_expiry_hours: 48, request_interacted_expiry_hours: 168 },
      error: null,
    });
    renderStep();
    await waitFor(() =>
      expect(card().getByText(/within 2 days, it closes automatically/)).toBeTruthy()
    );
  });

  it('falls back to the server default when the policy cannot be read', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    renderStep();
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    expect(card().getByText(/within 3 days, it closes automatically/)).toBeTruthy();
  });

  it('does not claim pay-at-hire for a bounty charged at publish', () => {
    renderStep({}, true);
    expect(card().queryByText(/only charged when you hire/)).toBeNull();
    expect(card().getByText(/Your \$40 is already held/)).toBeTruthy();
  });

  it('says no payment is involved for a for-honor bounty', () => {
    renderStep({ isForHonor: true, amount: 0 });
    expect(card().getByText('This is a for-honor bounty, so no payment is involved.')).toBeTruthy();
    expect(card().queryByText(/charged/)).toBeNull();
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('uses %s theme tokens for the card text and surface', (_name, theme) => {
    mockTheme = theme;
    renderStep();
    const text = flat(card().getByText(/You choose who to hire/).props.style);
    expect(text.color).toBe(theme.text);
    const surface = flat(screen.getByTestId('post-publish-what-next').props.style);
    expect(surface.backgroundColor).toBe(theme.surface);
  });
});
