import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../../lib/constants/support';
import { detectOffPlatformRisk, latestIncomingRisk } from '../../lib/utils/off-platform-risk';

describe('local off-platform risk detection', () => {
  it.each([
    'Pay me through Venmo @hunter',
    'My PayPal is @worker',
    'Can you Zelle me?',
    'Send it using Cash App',
    'Send $40 to $hunterName',
    'https://paypal.me/worker',
    'Use https://cash.app/$worker',
    'Send crypto before starting',
    'Pay me directly',
    'Pay me cash when you arrive',
    "I'll pay cash",
    'I accept cash only',
    'Outside Bounty, we can settle the payment',
    'Pay the fee to get this job',
    'Buy gift cards and send me the codes',
    'Do not pay outside Bounty. Pay me via Zelle instead.',
    "Don't worry, send me money on Venmo.",
    'Don’t share your number, but pay me through PayPal.',
  ])('identifies payment instructions: %s', text => {
    expect(detectOffPlatformRisk(text)).toBe('payment');
  });

  it.each([
    'Email me at worker@example.com',
    'worker@example.com',
    'Call me on +1 (212) 555-0199',
    '212-555-0199',
    'Text me',
    'Share your phone number',
    'Contact me on WhatsApp',
    "Let's move this chat off-platform",
    "Let's chat on Telegram",
    'https://wa.me/12125550199',
    'https://t.me/worker',
  ])('identifies contact instructions: %s', text => {
    expect(detectOffPlatformRisk(text)).toBe('contact');
  });

  it.each([
    '',
    'I need help repairing a cash register',
    'The job involves cash handling and bookkeeping.',
    'This is a $40 task.',
    'Bring cash register parts.',
    'I develop PayPal integrations.',
    'Here is my portfolio https://example.com/paypal/contact-me',
    'Job reference: https://example.com/2025/1234567890',
    'Due on 2026-10-04',
    'Never pay outside Bounty.',
    "Don't pay me cash.",
    'Don’t use Venmo or share your phone number.',
    'Do not share worker@example.com.',
    'Avoid sending money to https://paypal.me/worker',
    'No external payments.',
    `Email support at ${SUPPORT_EMAIL}`,
    `Contact us at ${SUPPORT_EMAIL}`,
    `Call us at ${SUPPORT_PHONE}`,
    'Keep agreements and payments here on Bounty.',
  ])('avoids ordinary references and safety advice: %s', text => {
    expect(detectOffPlatformRisk(text)).toBeNull();
  });

  it('does not allow a support address to hide a different contact', () => {
    expect(detectOffPlatformRisk(`Contact ${SUPPORT_EMAIL} or worker@example.com`)).toBe('contact');
    expect(detectOffPlatformRisk(`Contact ${SUPPORT_EMAIL}. Pay me through Venmo`)).toBe('payment');
  });

  it('selects the newest flagged incoming message, not the newest outgoing or harmless message', () => {
    const messages = [
      { id: 'new', text: 'Text me', createdAt: 30, isUser: false },
      { id: 'old', text: 'Pay via Venmo', createdAt: 10, isUser: false },
      { id: 'ordinary', text: 'Thanks!', createdAt: 40, isUser: false },
      { id: 'outgoing', text: 'Pay via Venmo', createdAt: 50, isUser: true },
    ];
    expect(latestIncomingRisk(messages, m => !m.isUser)?.message.id).toBe('new');
    expect(latestIncomingRisk(messages, () => false)).toBeNull();
    expect(latestIncomingRisk([], () => true)).toBeNull();
  });

  it('handles ISO timestamps and gives payments priority over contact details', () => {
    expect(detectOffPlatformRisk('Pay me via Zelle at worker@example.com')).toBe('payment');
    expect(latestIncomingRisk([
      { id: 'a', text: 'Text me', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'b', text: 'Pay via Zelle', createdAt: '2026-01-01T00:00:00Z' },
    ], () => true)?.message.id).toBe('a');
  });
});
