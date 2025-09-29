/**
 * Application configuration using environment variables
 * This centralizes all configuration to prevent hardcoding sensitive values
 */

import Constants from 'expo-constants';

// Helper function to get environment variables with fallbacks
const getEnvVar = (key: string, fallback?: string): string => {
  const value = process.env[key] || Constants.expoConfig?.extra?.[key];
  if (!value && !fallback) {
    console.warn(`Environment variable ${key} is not set`);
    return '';
  }
  return value || fallback || '';
};

// Stripe Configuration
export const STRIPE_CONFIG = {
  publishableKey: getEnvVar('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_placeholder'),
  merchantIdentifier: getEnvVar('EXPO_PUBLIC_STRIPE_MERCHANT_ID', 'merchant.com.bountyexpo-workspace'),
} as const;

// API Configuration
export const API_CONFIG = {
  baseUrl: getEnvVar('EXPO_PUBLIC_API_BASE_URL', 'https://your-hostinger-domain.com'),
  authUrl: getEnvVar('EXPO_PUBLIC_AUTH_API_URL', 'https://your-hostinger-api.com'),
} as const;

// App Configuration
export const APP_CONFIG = {
  environment: getEnvVar('EXPO_PUBLIC_APP_ENV', 'development'),
  version: getEnvVar('EXPO_PUBLIC_APP_VERSION', '1.0.0'),
} as const;

// Validation function to check if critical configuration is missing
export const validateConfig = (): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!STRIPE_CONFIG.publishableKey || STRIPE_CONFIG.publishableKey === 'pk_test_placeholder') {
    errors.push('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set or using placeholder value');
  }
  
  if (API_CONFIG.baseUrl.includes('your-hostinger-domain.com')) {
    errors.push('EXPO_PUBLIC_API_BASE_URL is not set to actual domain');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Log configuration status in development
if (__DEV__) {
  const validation = validateConfig();
  if (!validation.isValid) {
    console.warn('Configuration issues detected:', validation.errors);
  }
}