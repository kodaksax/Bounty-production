jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: { getCurrentProfile: () => null },
}));

import { getBountyPublishError } from '../../lib/utils/bounty-publish-error';
import { getUserFriendlyError } from '../../lib/utils/error-messages';

const GENERAL = 'Something went wrong while posting your bounty. Please try again in a moment.';

describe('getBountyPublishError', () => {
  it.each([
    // The incident: a trigger calling a missing function overload.
    'function public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], integer, unknown, text, jsonb) does not exist',
    'new row for relation "bounties" violates check constraint "bounties_amount_check"',
    'for-honor bounties are not currently accepted\n\nHint: Set an amount for this bounty.',
    'Relay insert failed: {"error":"internal"}',
    'Supabase is not configured.\n- EXPO_PUBLIC_SUPABASE_URL',
    'something nobody anticipated',
  ])('shows only the general message for %s', raw => {
    const out = getBountyPublishError(new Error(raw));
    expect(out.message).toBe(GENERAL);
    expect(out.title).toBe("Couldn't Post Bounty");
  });

  it('passes through fixed network copy without the developer hint', () => {
    const out = getBountyPublishError(
      new Error('Network request failed\n\nHint: Device could not reach API at http://10.0.0.2:3001')
    );
    expect(out.type).toBe('network');
    expect(out.message).not.toMatch(/10\.0\.0\.2|Hint/);
  });

  it('keeps title validation copy, which is safe and actionable', () => {
    expect(getBountyPublishError(new Error('Title must be at least 5 characters')).message).toBe(
      'Title must be at least 5 characters'
    );
  });

  it('keeps account-status copy', () => {
    expect(getBountyPublishError(new Error('account_suspended')).title).toBe('Account Suspended');
  });
});

describe('getUserFriendlyError sanitizing', () => {
  it('no longer echoes a missing-function error verbatim', () => {
    const raw =
      'function public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], integer, unknown, text, jsonb) does not exist';
    expect(getUserFriendlyError(new Error(raw)).message).not.toContain('fn_');
  });
});
