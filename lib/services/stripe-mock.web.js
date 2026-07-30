/**
 * Web stub for @stripe/stripe-react-native
 * This file provides error-throwing stubs for all Stripe SDK functions on web builds.
 * The actual stripe-service.ts handles web gracefully by checking for SDK availability
 * and using fallback implementations.
 */

// Export error-throwing stubs for all SDK functions
export const initStripe = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

export const createPaymentMethod = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

export const confirmPayment = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

export const initPaymentSheet = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

export const presentPaymentSheet = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

export const handleNextAction = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

// Native wallet (Apple Pay / Google Pay) entry points. isPlatformPaySupported
// resolves false rather than throwing, because callers use it as a capability
// probe and web is legitimately unsupported — throwing would force every call
// site into a try/catch just to learn "no".
export const isPlatformPaySupported = async () => false;

export const confirmPlatformPayPayment = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

export const confirmPlatformPaySetupIntent = async () => {
  throw new Error('Stripe SDK not available on web platform');
};

// Mirrors the real SDK's runtime enum namespaces so destructuring these on web
// yields the same shape instead of `undefined`.
export const PlatformPay = {
  PaymentType: { Deferred: 'Deferred', Immediate: 'Immediate', Recurring: 'Recurring' },
  ContactField: {
    EmailAddress: 'emailAddress',
    Name: 'name',
    PhoneNumber: 'phoneNumber',
    PhoneticName: 'phoneticName',
    PostalAddress: 'postalAddress',
  },
};

export const PlatformPayError = {
  Canceled: 'Canceled',
  Failed: 'Failed',
  Unknown: 'Unknown',
};

// Export any other functions that might be imported
export default {
  initStripe,
  createPaymentMethod,
  confirmPayment,
  initPaymentSheet,
  presentPaymentSheet,
  handleNextAction,
  isPlatformPaySupported,
  confirmPlatformPayPayment,
  confirmPlatformPaySetupIntent,
  PlatformPay,
  PlatformPayError,
};
