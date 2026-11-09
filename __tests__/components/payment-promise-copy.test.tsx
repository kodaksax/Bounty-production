/**
 * The `payment-promise-copy` flag on the composer's first and last steps and on
 * the public how-it-works page. Flag off must render today's wording; flag on
 * must render the approved strings and nothing else changes.
 * The hire sheet's own flag cases live in accept-funding-gate.test.tsx.
 */
import { AccessibilityInfo } from 'react-native';
import { render } from '@testing-library/react-native';
import React from 'react';

// InfoTooltip calls this; the RN jest preset's mock omits it.
(AccessibilityInfo as unknown as { announceForAccessibility: jest.Mock }).announceForAccessibility =
  jest.fn();

let mockPaymentPromiseOn = false;
jest.mock('../../lib/experiments/payment-promise-copy', () => ({
  usePaymentPromiseCopy: () => mockPaymentPromiseOn,
}));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({ balance: 0 })),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../hooks/usePostingPolicy', () => {
  const policy = { honorPostsEnabled: true, minimumAmount: 1 };
  return { __esModule: true, default: () => policy, usePostingPolicy: () => policy };
});
jest.mock('../../hooks/usePostingCardGate', () => ({
  usePostingCardGate: () => ({
    cardStepExpected: false,
    checking: false,
    showCardSheet: false,
    dismissed: false,
    onCardSheetClose: () => {},
    requestPublish: () => {},
  }),
}));
jest.mock('../../components/payment-methods-modal', () => ({ PaymentMethodsModal: () => null }));
jest.mock('../../components/ui/settings-screen-header', () => ({ SettingsScreenHeader: () => null }));
jest.mock('../../lib/analytics/trust-content', () => ({
  consumeTrustContentSurface: () => 'test',
  markTrustContentSurface: jest.fn(),
  trackTrustContentViewed: jest.fn(),
}));

import HowItWorksRoute from '../../app/legal/how-it-works';
import { StepPay } from '../../app/screens/CreateBounty/quick/StepPay';
import { StepTask } from '../../app/screens/CreateBounty/quick/StepTask';
import { PLATFORM_FEE_DISPLAY } from '../../lib/constants/fees';
import { fundingSourceLine, paymentPromiseStrings } from '../../lib/strings/payment-promise';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

const STEP_1 =
  'Free to post. You pay only when you hire someone, and we hold the payment while the work gets done.';
const STEP_3 =
  'Free to post. You pay only when you hire someone, and we hold the payment until you approve the work or a dispute is settled.';
const OLD_FEES_PHRASE = /for some first bounties/;

const draft = (overrides: Record<string, unknown> = {}) =>
  ({
    title: 'Assemble my desk',
    description: '',
    amount: 40,
    isForHonor: false,
    category: 'other',
    workType: 'in_person',
    location: '',
    ...overrides,
  }) as any;

const renderTask = () =>
  render(<StepTask draft={draft()} onUpdate={jest.fn()} onNext={jest.fn()} step={1} totalSteps={3} />);

const renderPay = (overrides: Record<string, unknown> = {}) =>
  render(
    <StepPay
      draft={draft(overrides)}
      onUpdate={jest.fn()}
      onNext={jest.fn()}
      onBack={jest.fn()}
      step={3}
      totalSteps={3}
    />
  );

describe('payment-promise-copy', () => {
  beforeEach(() => {
    mockPaymentPromiseOn = false;
  });

  describe('StepTask', () => {
    test('off: no new line', () => {
      const { getByText, queryByText } = renderTask();
      expect(getByText('Name it. Set a reward. Someone nearby gets it done.')).toBeTruthy();
      expect(queryByText(STEP_1)).toBeNull();
    });

    test('on: the approved line sits with the subtitle', () => {
      mockPaymentPromiseOn = true;
      const { getByText } = renderTask();
      expect(getByText('Name it. Set a reward. Someone nearby gets it done.')).toBeTruthy();
      expect(getByText(STEP_1)).toBeTruthy();
    });
  });

  describe('StepPay', () => {
    test('off: today\'s title', () => {
      const { getByText, queryByText } = renderPay();
      expect(getByText(trustSafetyStrings.payWhenYouHire)).toBeTruthy();
      expect(queryByText(STEP_3)).toBeNull();
    });

    test('on: the approved line replaces the title', () => {
      mockPaymentPromiseOn = true;
      const { getByText, queryByText } = renderPay();
      expect(getByText(STEP_3)).toBeTruthy();
      expect(queryByText(trustSafetyStrings.payWhenYouHire)).toBeNull();
    });

    test.each([false, true])('the fee sentence is the same with the flag %s', (on) => {
      mockPaymentPromiseOn = on;
      const { getByText } = renderPay();
      expect(
        getByText(
          `You pay $40 when you hire, and it's released when you approve the work. Bounty takes a ${PLATFORM_FEE_DISPLAY} service fee out of it, so the hunter takes home $36.80 — and they see that number before they apply.`
        )
      ).toBeTruthy();
    });

    test('on: a for-honor bounty is never told it will be charged', () => {
      mockPaymentPromiseOn = true;
      const { getByText, queryByText } = renderPay({ isForHonor: true, amount: 0 });
      expect(getByText('This is a for-honor bounty.')).toBeTruthy();
      expect(queryByText(STEP_3)).toBeNull();
    });
  });

  describe('how-it-works', () => {
    test('off: today\'s wording', () => {
      const { getByText } = render(<HowItWorksRoute />);
      expect(getByText(OLD_FEES_PHRASE)).toBeTruthy();
    });

    test('on: pay-at-hire for everyone, fee from the hunter\'s share', () => {
      mockPaymentPromiseOn = true;
      const { getByText, queryByText } = render(<HowItWorksRoute />);
      expect(getByText(paymentPromiseStrings.howItWorksFees(PLATFORM_FEE_DISPLAY))).toBeTruthy();
      expect(queryByText(OLD_FEES_PHRASE)).toBeNull();
    });
  });

  describe('fundingSourceLine', () => {
    const money = (n: number) => `$${n.toFixed(2)}`;

    test('uses the balance alone when nothing is charged', () => {
      expect(fundingSourceLine(30, 0, money)).toBe('$30.00 comes from your Bounty balance now.');
    });

    test('uses the card alone when the balance contributes nothing', () => {
      expect(fundingSourceLine(30, 30, money)).toBe('Your card is charged $30.00 now.');
    });

    test('splits the reward between balance and card', () => {
      expect(fundingSourceLine(30, 20, money)).toBe(
        '$10.00 from your Bounty balance and $20.00 charged to your card now.'
      );
    });

    test('a charge at the $0.50 floor above the reward is card only', () => {
      expect(fundingSourceLine(0.3, 0.5, money)).toBe('Your card is charged $0.50 now.');
    });
  });

  test('no string quotes a 15% fee', () => {
    const rendered = [
      paymentPromiseStrings.stepTaskLine,
      paymentPromiseStrings.stepPayLine,
      paymentPromiseStrings.fundingHold,
      paymentPromiseStrings.howItWorksFees(PLATFORM_FEE_DISPLAY),
    ].join(' ');
    expect(rendered).not.toMatch(/15\s?%/);
  });
});
