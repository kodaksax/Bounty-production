import {
  buildZeroTokenWarning,
  MAX_LOGGED_RECIPIENTS,
} from '../../supabase/functions/process-notification/push-delivery-diagnostics';

describe('buildZeroTokenWarning', () => {
  it('names the notification type and the recipients who got nothing', () => {
    const warning = buildZeroTokenWarning({
      notificationId: 'outbox-1',
      notificationType: 'bounty_nearby',
      pushRecipients: ['user-a', 'user-b'],
    });

    expect(warning).toEqual({
      notificationId: 'outbox-1',
      notificationType: 'bounty_nearby',
      recipientCount: 2,
      recipients: ['user-a', 'user-b'],
      truncated: false,
    });
  });

  it('caps the logged recipients so a fan-out cannot produce an unbounded log line', () => {
    const many = Array.from({ length: 250 }, (_, i) => `user-${i}`);

    const warning = buildZeroTokenWarning({
      notificationId: 'outbox-2',
      notificationType: 'bounty_nearby',
      pushRecipients: many,
    });

    // The full count survives even though the sample is trimmed — otherwise the
    // warning would understate the size of the delivery gap.
    expect(warning.recipientCount).toBe(250);
    expect(warning.recipients).toHaveLength(MAX_LOGGED_RECIPIENTS);
    expect(warning.recipients[0]).toBe('user-0');
    expect(warning.truncated).toBe(true);
  });

  it('does not mark a list at exactly the cap as truncated', () => {
    const exact = Array.from({ length: MAX_LOGGED_RECIPIENTS }, (_, i) => `user-${i}`);

    const warning = buildZeroTokenWarning({
      notificationId: 'outbox-3',
      notificationType: 'message_received',
      pushRecipients: exact,
    });

    expect(warning.truncated).toBe(false);
    expect(warning.recipients).toHaveLength(MAX_LOGGED_RECIPIENTS);
  });

  it('degrades to "unknown" rather than throwing on a malformed outbox row', () => {
    const warning = buildZeroTokenWarning({
      notificationId: null,
      notificationType: '',
      pushRecipients: [],
    });

    expect(warning.notificationId).toBe('unknown');
    expect(warning.notificationType).toBe('unknown');
    expect(warning.recipientCount).toBe(0);
  });
});
