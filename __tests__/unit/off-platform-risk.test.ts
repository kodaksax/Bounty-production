import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../../lib/constants/support';
import { detectOffPlatformRisk, latestIncomingRisk } from '../../lib/utils/off-platform-risk';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

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
    'Pay me via Apple Pay outside Bounty',
    'Pay me directly with Google Pay',
    'Use Apple Pay in Bounty to fund the job. Pay me via Venmo instead.',
    'Pay through Bounty using Apple Pay, or send me money with Apple Pay',
    'Use Google Pay through Bounty, but pay me directly with Google Pay',
    'Use Apple Pay in Bounty, or pay outside Bounty with Apple Pay',
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
    "Let's talk outside Bounty",
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
    'Pay with Apple Pay in Bounty',
    'Use Apple Pay in Bounty to fund the job',
    'Pay through Bounty using Apple Pay.',
    'Use Google Pay in Bounty to fund the job',
    'Pay through Bounty using Google Pay.',
    'Pay with Google Pay through Bounty',
    'Use Apple Pay for checkout',
    'Use Google Pay',
    'Pay me with Apple Pay in Bounty',
    'Pay through Bounty instead of Venmo',
    'Pay on Bounty, not PayPal',
    'Payment outside Bounty is not protected',
    "Bounty can't protect payment outside Bounty",
    'I accept cash register repair jobs.',
    'We need a developer: https://paypal.com/docs',
    "I don't want to pay outside Bounty.",
    '{"ciphertext":"12345678901","nonce":"abc","senderPublicKey":"12345678901"}',
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

  it('does not treat attacker-controlled JSON as an encrypted envelope', () => {
    expect(detectOffPlatformRisk(
      '{"ciphertext":"Pay me through Venmo @hunter","nonce":"abc","senderPublicKey":"key"}'
    )).toBe('payment');
  });

  it.each(Object.values(trustSafetyStrings))('does not flag shared protection guidance: %s', text => {
    expect(detectOffPlatformRisk(text)).toBeNull();
  });

  it('does not let safe wallet guidance hide contact instructions in another clause', () => {
    expect(detectOffPlatformRisk('Use Apple Pay in Bounty. Text me on WhatsApp')).toBe('contact');
    expect(detectOffPlatformRisk('Pay through Bounty using Google Pay, and email me at worker@example.com')).toBe('contact');
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
