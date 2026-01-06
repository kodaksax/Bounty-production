/**
 * Web mock for @stripe/stripe-react-native
 * This file provides empty implementations of all Stripe SDK functions for web builds.
 * The actual stripe-service.ts handles web gracefully by checking for SDK availability.
 */

// Export empty/mock implementations for all SDK functions
export const initStripe = async () => {
  throw new Error('SDK not available in test environment');
};

export const createPaymentMethod = async () => {
  throw new Error('SDK not available in test environment');
};

export const confirmPayment = async () => {
  throw new Error('SDK not available in test environment');
};

export const initPaymentSheet = async () => {
  throw new Error('SDK not available in test environment');
};

export const presentPaymentSheet = async () => {
  throw new Error('SDK not available in test environment');
};

export const handleNextAction = async () => {
  throw new Error('SDK not available in test environment');
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
