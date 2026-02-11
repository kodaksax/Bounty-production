/**
 * Configuration Validation Utility
 * Validates that all required environment variables are present and properly formatted
 * Run at app startup to catch configuration issues early
 */

import { Platform } from 'react-native';

export interface ConfigValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IntegrationStatus {
  name: string;
  enabled: boolean;
  configured: boolean;
  missingVars: string[];
}

/**
 * Validate Stripe/Payment configuration
 */
export function validatePaymentConfig(): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check Stripe publishable key (client-side)
  const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!stripePublishableKey) {
    errors.push('Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY - Payments will not work');
  } else if (stripePublishableKey.startsWith('pk_test_')) {
    warnings.push('Using Stripe test key - Switch to live key for production');
  } else if (!stripePublishableKey.startsWith('pk_live_') && !stripePublishableKey.startsWith('pk_test_')) {
    errors.push('Invalid Stripe publishable key format - Must start with pk_live_ or pk_test_');
  }

  // Check Apple Merchant ID (iOS only)
  if (Platform.OS === 'ios') {
    const merchantId = process.env.APPLE_MERCHANT_ID;
    if (!merchantId) {
      warnings.push('Missing APPLE_MERCHANT_ID - Apple Pay will be disabled');
    } else if (!merchantId.startsWith('merchant.')) {
      warnings.push('APPLE_MERCHANT_ID should start with "merchant." - Verify format');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate Apple Authentication configuration
 */
export function validateAppleAuthConfig(): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check Service ID (required for Android, helpful info for iOS)
  const serviceId = process.env.EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID;
  if (!serviceId) {
    if (Platform.OS === 'android') {
      warnings.push('Missing EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID - Apple Sign In disabled on Android');
    } else {
      warnings.push('EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID not set (iOS uses native flow)');
    }
  }

  // Check Redirect URI (required for Android)
  const redirectUri = process.env.EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI;
  if (!redirectUri) {
    if (Platform.OS === 'android') {
      warnings.push('Missing EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI - Apple Sign In disabled on Android');
    }
  } else if (!redirectUri.startsWith('https://')) {
    errors.push('EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI must use HTTPS');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate Google Sign-in configuration
 */
export function validateGoogleSignInConfig(): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check platform-specific client IDs
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  if (Platform.OS === 'ios') {
    if (!iosClientId) {
      warnings.push('Missing EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID - Google Sign In disabled on iOS');
    } else if (iosClientId.includes('placeholder')) {
      warnings.push('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is placeholder - Google Sign In disabled');
    } else if (!iosClientId.endsWith('.apps.googleusercontent.com')) {
      errors.push('Invalid EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID format - Must end with .apps.googleusercontent.com');
    }
  }

  if (Platform.OS === 'android') {
    if (!androidClientId) {
      warnings.push('Missing EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID - Google Sign In disabled on Android');
    } else if (androidClientId.includes('placeholder')) {
      warnings.push('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID is placeholder - Google Sign In disabled');
    } else if (!androidClientId.endsWith('.apps.googleusercontent.com')) {
      errors.push('Invalid EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID format - Must end with .apps.googleusercontent.com');
    }
  }

  if (Platform.OS === 'web') {
    if (!webClientId) {
      warnings.push('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID - Google Sign In disabled on Web');
    } else if (webClientId.includes('placeholder')) {
      warnings.push('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is placeholder - Google Sign In disabled');
    } else if (!webClientId.endsWith('.apps.googleusercontent.com')) {
      errors.push('Invalid EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID format - Must end with .apps.googleusercontent.com');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate Supabase configuration
 */
export function validateSupabaseConfig(): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    errors.push('Missing EXPO_PUBLIC_SUPABASE_URL - App will not function');
  } else if (!supabaseUrl.startsWith('https://')) {
    errors.push('EXPO_PUBLIC_SUPABASE_URL must use HTTPS');
  } else if (!supabaseUrl.includes('.supabase.co')) {
    warnings.push('EXPO_PUBLIC_SUPABASE_URL format unusual - Verify it is correct');
  }

  if (!supabaseAnonKey) {
    errors.push('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY - App will not function');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get status of all integrations
 */
export function getIntegrationStatus(): IntegrationStatus[] {
  const statuses: IntegrationStatus[] = [];

  // Payment Integration
  const paymentValidation = validatePaymentConfig();
  statuses.push({
    name: 'Payment (Stripe)',
    enabled: !!process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    configured: paymentValidation.isValid,
    missingVars: paymentValidation.errors.map(e => e.split('-')[0].trim()),
  });

  // Apple Pay
  const applePayConfigured = Platform.OS === 'ios' && !!process.env.APPLE_MERCHANT_ID;
  statuses.push({
    name: 'Apple Pay',
    enabled: Platform.OS === 'ios',
    configured: applePayConfigured,
    missingVars: applePayConfigured ? [] : ['APPLE_MERCHANT_ID'],
  });

  // Apple Authentication
  const appleAuthValidation = validateAppleAuthConfig();
  const appleAuthConfigured = !!process.env.EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID && 
                               !!process.env.EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI;
  statuses.push({
    name: 'Apple Sign In',
    enabled: true,
    configured: appleAuthConfigured || Platform.OS === 'ios', // iOS uses native, doesn't need Service ID
    missingVars: appleAuthValidation.warnings.map(w => {
      if (w.includes('SERVICE_ID')) return 'EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID';
      if (w.includes('REDIRECT_URI')) return 'EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI';
      return '';
    }).filter(Boolean),
  });

  // Google Sign-in
  const googleValidation = validateGoogleSignInConfig();
  const googleClientId = Platform.select({
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    default: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
  const googleConfigured = !!googleClientId && !googleClientId.includes('placeholder');
  statuses.push({
    name: 'Google Sign In',
    enabled: true,
    configured: googleConfigured,
    missingVars: googleValidation.warnings.map(w => {
      if (w.includes('IOS_CLIENT_ID')) return 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID';
      if (w.includes('ANDROID_CLIENT_ID')) return 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID';
      if (w.includes('WEB_CLIENT_ID')) return 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID';
      return '';
    }).filter(Boolean),
  });

  // Supabase
  const supabaseValidation = validateSupabaseConfig();
  statuses.push({
    name: 'Supabase',
    enabled: true,
    configured: supabaseValidation.isValid,
    missingVars: supabaseValidation.errors.map(e => e.split('-')[0].trim()),
  });

  return statuses;
}

/**
 * Validate all configuration and return combined result
 */
export function validateAllConfig(): ConfigValidation {
  const payment = validatePaymentConfig();
  const appleAuth = validateAppleAuthConfig();
  const googleAuth = validateGoogleSignInConfig();
  const supabase = validateSupabaseConfig();

  const allErrors = [
    ...payment.errors,
    ...appleAuth.errors,
    ...googleAuth.errors,
    ...supabase.errors,
  ];

  const allWarnings = [
    ...payment.warnings,
    ...appleAuth.warnings,
    ...googleAuth.warnings,
    ...supabase.warnings,
  ];

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Log configuration validation results
 * Call this at app startup to verify configuration
 */
export function logConfigurationStatus(): void {
  console.log('\n🔍 Configuration Validation\n');
  console.log('═══════════════════════════════════════════════════════════════');

  const validation = validateAllConfig();
  const integrations = getIntegrationStatus();

  // Log integration statuses
  console.log('\n📊 Integration Status:\n');
  integrations.forEach((integration) => {
    const statusIcon = integration.configured ? '✅' : '⚠️';
    const status = integration.configured ? 'Configured' : 'Not Configured';
    console.log(`${statusIcon} ${integration.name}: ${status}`);
    if (!integration.configured && integration.missingVars.length > 0) {
      console.log(`   Missing: ${integration.missingVars.join(', ')}`);
    }
  });

  // Log errors
  if (validation.errors.length > 0) {
    console.log('\n❌ Configuration Errors:\n');
    validation.errors.forEach((error) => {
      console.log(`   • ${error}`);
    });
  }

  // Log warnings
  if (validation.warnings.length > 0) {
    console.log('\n⚠️ Configuration Warnings:\n');
    validation.warnings.forEach((warning) => {
      console.log(`   • ${warning}`);
    });
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  if (validation.isValid) {
    console.log('✅ Configuration validation passed');
    if (validation.warnings.length > 0) {
      console.log(`⚠️  ${validation.warnings.length} warning(s) - Some features may be disabled`);
    }
  } else {
    console.log('❌ Configuration validation failed');
    console.log(`   ${validation.errors.length} error(s) must be fixed`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Check if a specific integration is properly configured
 */
export function isIntegrationConfigured(integrationName: 'payment' | 'applePay' | 'appleAuth' | 'googleAuth'): boolean {
  switch (integrationName) {
    case 'payment':
      return validatePaymentConfig().isValid;
    case 'applePay':
      return Platform.OS === 'ios' && !!process.env.APPLE_MERCHANT_ID;
    case 'appleAuth':
      return validateAppleAuthConfig().isValid || Platform.OS === 'ios'; // iOS native doesn't need Service ID
    case 'googleAuth':
      return validateGoogleSignInConfig().isValid;
    default:
      return false;
  }
}

/**
 * Throw error if critical configuration is missing
 * Call this at app startup to prevent running with invalid config
 */
export function requireValidConfig(): void {
  const validation = validateAllConfig();
  
  if (!validation.isValid) {
    const errorMessage = [
      '❌ Invalid Configuration',
      '',
      'The following configuration errors must be fixed:',
      ...validation.errors.map(e => `  • ${e}`),
      '',
      'Please check your .env file and ensure all required variables are set.',
      'See .env.example for reference.',
    ].join('\n');
    
    throw new Error(errorMessage);
  }
}
