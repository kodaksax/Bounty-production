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

// Export any other functions that might be imported
export default {
  initStripe,
  createPaymentMethod,
  confirmPayment,
  initPaymentSheet,
  presentPaymentSheet,
  handleNextAction,
};
