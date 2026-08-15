import * as Sentry from '@sentry/react-native';

const upsert = jest.fn(() => Promise.resolve({ error: null }));
const from = jest.fn(() => ({ upsert }));

jest.mock('@sentry/react-native');
jest.mock('../../../../lib/supabase', () => ({
  supabase: { from },
}));

import { momentsService } from '../../../../lib/moments/momentsService';

describe('momentsService.markDismissed', () => {
  beforeEach(() => {
    from.mockClear();
    upsert.mockClear();
    jest.mocked(Sentry.captureMessage).mockClear();
  });

  it('rejects a dismissal before the current presentation has elapsed 750ms', async () => {
    const accepted = await momentsService.markDismissed(
      'user-1',
      'identity_verification',
      Date.now() - 100
    );

    expect(accepted).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });

  it('rejects an out-of-order dismissal with a future show timestamp', async () => {
    const accepted = await momentsService.markDismissed(
      'user-1',
      'add_profile_photo',
      Date.now() + 1740
    );

    expect(accepted).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes a deliberate dismissal after the guard window', async () => {
    const accepted = await momentsService.markDismissed(
      'user-1',
      'stripe_connect_onboarding',
      Date.now() - 1000
    );

    expect(accepted).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        moment_type: 'stripe_connect_onboarding',
        status: 'dismissed',
      }),
      { onConflict: 'user_id,moment_type' }
    );
  });
});
