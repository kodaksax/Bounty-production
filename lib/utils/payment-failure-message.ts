/**
 * Plain-words explanation of a failed payment, for the payer.
 *
 * Reads the same FailureEventProps that payment_failed carries, so what the
 * poster is told and what analytics records can never disagree. Every
 * message says what happened and what to do next.
 *
 * Fraud-flavoured decline codes (fraudulent, stolen_card, lost_card, ...)
 * are deliberately shown as an ordinary bank decline — Stripe's guidance,
 * and telling a fraudster which signal tripped helps them.
 */

import type { FailureEventProps } from './stripe-error';

export type PaymentFailureAction =
  /** Another card or wallet is the way forward. */
  | 'another_method'
  /** Transient; the same method may well work in a moment. */
  | 'retry';

export interface PaymentFailureMessage {
  title: string;
  message: string;
  action: PaymentFailureAction;
}

export interface PaymentFailureMessageOptions {
  /** The wallet this device can pay with, if any. Offered as the alternative. */
  walletName?: 'Apple Pay' | 'Google Pay' | null;
}

const INSUFFICIENT = new Set(['insufficient_funds']);
const ZIP = new Set(['incorrect_zip']);
const CVC = new Set(['incorrect_cvc', 'invalid_cvc']);
const EXPIRED = new Set(['expired_card']);
const NUMBER = new Set(['incorrect_number', 'invalid_number']);
const AUTH = new Set([
  'authentication_required',
  'authentication_failed',
  'payment_intent_authentication_failure',
]);
const LIMIT = new Set(['card_velocity_exceeded', 'withdrawal_count_limit_exceeded']);
const TRANSIENT = new Set(['processing_error', 'try_again_later', 'rate_limit']);
const TRANSIENT_TYPES = new Set(['api_connection_error', 'rate_limit_error']);

export function describePaymentFailure(
  failure: FailureEventProps | null | undefined,
  options: PaymentFailureMessageOptions = {}
): PaymentFailureMessage {
  const codes = [failure?.decline_code, failure?.code, failure?.error_code].filter(
    (c): c is string => typeof c === 'string' && c.length > 0
  );
  const has = (set: Set<string>) => codes.some(c => set.has(c));
  const type = failure?.type ?? failure?.error_type;

  // Don't suggest the wallet that just failed.
  const wallet =
    options.walletName &&
    !(
      (options.walletName === 'Apple Pay' && failure?.payment_method_type === 'apple_pay') ||
      (options.walletName === 'Google Pay' && failure?.payment_method_type === 'google_pay')
    )
      ? options.walletName
      : null;
  const tryAnother = wallet ? `Try another card or ${wallet}.` : 'Try another card.';
  const paidWithApplePay = failure?.payment_method_type === 'apple_pay';

  if (has(INSUFFICIENT)) {
    return {
      title: "This card doesn't have enough funds.",
      message: `Your bank declined it for this amount. ${tryAnother}`,
      action: 'another_method',
    };
  }
  if (has(ZIP)) {
    return {
      title: "Your bank couldn't match the billing ZIP code.",
      message: paidWithApplePay
        ? `Check the billing address on this card in Apple Wallet, or try another card.`
        : `Check the ZIP code saved with this card. ${tryAnother}`,
      action: 'another_method',
    };
  }
  if (has(CVC)) {
    return {
      title: "The card's security code didn't match.",
      message: `Check the 3-digit code on the back and add the card again. ${tryAnother}`,
      action: 'another_method',
    };
  }
  if (has(EXPIRED)) {
    return { title: 'This card has expired.', message: tryAnother, action: 'another_method' };
  }
  if (has(NUMBER)) {
    return {
      title: "Your bank didn't recognise this card number.",
      message: tryAnother,
      action: 'another_method',
    };
  }
  if (has(AUTH)) {
    return {
      title: "Your bank's approval step wasn't completed.",
      message: `Nothing was charged. Try again and approve it when your bank asks, or use another card.`,
      action: 'retry',
    };
  }
  if (has(LIMIT)) {
    return {
      title: 'This card has reached a spending limit.',
      message: `Your bank has paused payments on it for now. ${tryAnother}`,
      action: 'another_method',
    };
  }
  if (has(TRANSIENT) || (type && TRANSIENT_TYPES.has(type))) {
    return {
      title: "We couldn't reach your bank.",
      message: 'Nothing was charged. Wait a moment and try again.',
      action: 'retry',
    };
  }
  // Every other card error is a decline: generic_decline, do_not_honor,
  // fraudulent, lost/stolen, card_not_supported, ...
  if (type === 'card_error' || failure?.decline_code) {
    return {
      title: 'Your bank declined this card.',
      message: tryAnother,
      action: 'another_method',
    };
  }
  return {
    title: "This payment didn't go through.",
    message: `Try again in a moment, or use another card${wallet ? ` or ${wallet}` : ''}.`,
    action: 'retry',
  };
}
