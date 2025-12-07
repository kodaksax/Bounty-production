/**
 * Payment Security Configuration
 * Implements Stripe's security best practices and PCI compliance requirements
 * @see https://stripe.com/docs/security/guide
 * @see https://stripe.com/docs/security/best-practices
 */

/**
 * Content Security Policy (CSP) Headers for Stripe.js and Elements
 * These headers should be configured in your web server or CDN
 * 
 * For production deployment:
 * 1. Add these CSP directives to your server configuration
 * 2. Adjust 'self' origins based on your domain
 * 3. Enable reporting to monitor violations
 */
export const STRIPE_CSP_DIRECTIVES = {
  /**
   * Script sources - Allow Stripe.js library
   */
  'script-src': [
    "'self'",
    'https://js.stripe.com',
    // For inline scripts in production, use nonces instead of 'unsafe-inline'
    // Example: "'nonce-{random-value}'"
  ],

  /**
   * Frame sources - Allow Stripe Elements and 3D Secure
   */
  'frame-src': [
    "'self'",
    'https://js.stripe.com',
    'https://hooks.stripe.com',
    // 3D Secure authentication frames
    'https://*.stripe.com',
  ],

  /**
   * Connect sources - Allow API calls to Stripe
   */
  'connect-src': [
    "'self'",
    'https://api.stripe.com',
    'https://merchant-ui-api.stripe.com',
    // For webhooks and real-time updates
    'wss://*.stripe.com',
  ],

  /**
   * Image sources - Allow Stripe logos and icons
   */
  'img-src': [
    "'self'",
    'data:',
    'https://*.stripe.com',
  ],

  /**
   * Style sources - Allow Stripe Elements styling
   */
  'style-src': [
    "'self'",
    // Use nonces for inline styles in production
    "'unsafe-inline'", // Only for development; replace with nonces
  ],
};

/**
 * Generate CSP header string
 */
export function generateCSPHeader(): string {
  return Object.entries(STRIPE_CSP_DIRECTIVES)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * TLS/HTTPS Requirements
 * All payment processing MUST use HTTPS with TLS 1.2+
 */
export const TLS_REQUIREMENTS = {
  /**
   * Minimum TLS version required
   */
  minimumVersion: 'TLSv1.2',

  /**
   * Recommended cipher suites (in order of preference)
   * @see https://stripe.com/docs/security#tls
   */
  recommendedCiphers: [
    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
  ],

  /**
   * Certificate requirements
   */
  certificate: {
    validCA: true,
    notExpired: true,
    matchesHostname: true,
    minimumKeySize: 2048, // RSA key size in bits
  },
};

/**
 * Validate if current connection meets TLS requirements
 * Note: This is a simplified check; actual implementation depends on your server
 */
export function validateTLSConnection(protocol?: string): boolean {
  if (!protocol) {
    return false;
  }

  // In production, check actual TLS version from request
  // This is a simplified example
  const isTLS = protocol.toLowerCase().includes('https');
  
  if (!isTLS) {
    console.error('[Security] HTTPS is required for all payment operations');
    return false;
  }

  return true;
}

/**
 * Strong Customer Authentication (SCA) Configuration
 * Required for European payments under PSD2
 * @see https://stripe.com/docs/strong-customer-authentication
 */
export const SCA_CONFIG = {
  /**
   * Enable SCA for all transactions
   */
  enabled: true,

  /**
   * Request 3D Secure for specific scenarios
   */
  require3DS: {
    // Always for European cards
    europeanCards: true,
    // For high-value transactions (configurable threshold)
    highValueThreshold: 250, // USD
    // For first-time customers
    firstTimeCustomers: true,
    // For suspicious transactions (Radar integration)
    suspiciousActivity: true,
  },

  /**
   * Exemption handling
   * @see https://stripe.com/docs/strong-customer-authentication/exemptions
   */
  exemptions: {
    // Low-value transactions (under €30)
    lowValue: {
      enabled: true,
      threshold: 30, // EUR
    },
    // Trusted beneficiaries
    trustedBeneficiaries: {
      enabled: false, // Requires customer whitelisting
    },
    // Transaction Risk Analysis
    transactionRiskAnalysis: {
      enabled: true, // Let Stripe Radar handle
    },
  },
};

/**
 * Check if SCA is required for a transaction
 */
export function isSCARequired(params: {
  amount: number;
  currency: string;
  customerRegion?: string;
  isFirstTransaction?: boolean;
  riskScore?: number;
}): boolean {
  const { amount, currency, customerRegion, isFirstTransaction, riskScore } = params;

  // Always require SCA for European customers
  const europeanRegions = ['EU', 'GB', 'UK', 'EEA'];
  if (customerRegion && europeanRegions.includes(customerRegion.toUpperCase())) {
    // Check for low-value exemption
    if (currency === 'EUR' && amount < SCA_CONFIG.exemptions.lowValue.threshold) {
      return false; // Exemption applies
    }
    return true;
  }

  // High-value transactions
  const amountUSD = convertToUSD(amount, currency);
  if (amountUSD >= SCA_CONFIG.require3DS.highValueThreshold) {
    return true;
  }

  // First-time customers
  if (SCA_CONFIG.require3DS.firstTimeCustomers && isFirstTransaction) {
    return true;
  }

  // High-risk transactions
  if (riskScore !== undefined && riskScore > 75) {
    return true;
  }

  return false;
}

/**
 * Simple currency conversion helper (use real rates in production)
 */
function convertToUSD(amount: number, currency: string): number {
  // In production, use real-time exchange rates
  const rates: Record<string, number> = {
    USD: 1,
    EUR: 1.08,
    GBP: 1.27,
    CAD: 0.72,
  };
  return amount * (rates[currency.toUpperCase()] || 1);
}

/**
 * PCI Compliance Requirements
 * @see https://stripe.com/docs/security/guide#pci-compliance
 */
export const PCI_COMPLIANCE = {
  /**
   * Card data handling rules
   */
  cardDataHandling: {
    // NEVER store full card numbers
    storeFullCardNumber: false,
    // NEVER store CVV/CVC
    storeCVC: false,
    // NEVER store unencrypted data
    encryptionRequired: true,
    // Use Stripe.js to tokenize cards client-side
    useStripeJS: true,
  },

  /**
   * Server requirements
   */
  serverRequirements: {
    // Use HTTPS for all payment pages
    httpsOnly: true,
    // Keep software up to date
    patchedSoftware: true,
    // Implement firewall
    firewallEnabled: true,
    // Restrict access to cardholder data
    accessControl: true,
  },

  /**
   * Logging and monitoring
   */
  monitoring: {
    // Log all access to payment systems
    logAccess: true,
    // Monitor for anomalies
    anomalyDetection: true,
    // Regular security scans
    regularScans: true,
  },
};

/**
 * Stripe Radar Configuration
 * For fraud prevention and risk management
 * @see https://stripe.com/docs/radar
 */
export const RADAR_CONFIG = {
  /**
   * Enable Radar for fraud detection
   * Note: Requires Radar to be enabled in Stripe Dashboard
   */
  enabled: true,

  /**
   * Risk thresholds
   */
  riskThresholds: {
    // Block payments above this risk score
    blockThreshold: 85,
    // Review payments above this score
    reviewThreshold: 65,
    // Allow payments below this score
    allowThreshold: 30,
  },

  /**
   * Rules configuration
   * These should be configured in Stripe Dashboard
   */
  rules: {
    // Block payments from high-risk countries
    blockHighRiskCountries: true,
    // Require 3DS for high-value transactions
    require3DSHighValue: true,
    // Block if IP doesn't match billing country
    blockIPMismatch: false, // Can cause false positives
    // Limit transaction velocity
    velocityChecks: true,
  },

  /**
   * Custom rules (examples)
   */
  customRules: [
    {
      name: 'Block high-value first-time customer',
      condition: 'amount > 500 AND customer_transactions_count = 0',
      action: 'block',
    },
    {
      name: 'Review mismatched billing',
      condition: 'ip_country != card_country',
      action: 'review',
    },
  ],
};

/**
 * Idempotency Configuration
 * For preventing duplicate charges
 */
export const IDEMPOTENCY_CONFIG = {
  /**
   * Key generation settings
   */
  keyGeneration: {
    // Algorithm for generating keys
    algorithm: 'sha256',
    // Include these fields in hash
    includeFields: ['userId', 'amount', 'currency', 'timestamp', 'purpose'],
  },

  /**
   * Storage settings
   */
  storage: {
    // How long to store idempotency keys (24 hours recommended)
    ttl: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    // Storage backend (use Redis or database in production)
    backend: 'memory', // 'memory' | 'redis' | 'database'
  },

  /**
   * Retry settings
   */
  retry: {
    // Maximum number of retries
    maxRetries: 3,
    // Base delay between retries (exponential backoff)
    baseDelayMs: 1000,
    // Maximum delay between retries
    maxDelayMs: 5000,
  },
};

/**
 * Webhook Security Configuration
 */
export const WEBHOOK_CONFIG = {
  /**
   * Signature verification
   */
  signatureVerification: {
    // Always verify webhook signatures
    required: true,
    // Reject events with missing signatures
    rejectUnsigned: true,
    // Tolerance for timestamp differences (5 minutes)
    timestampTolerance: 300, // seconds
  },

  /**
   * Replay attack prevention
   */
  replayPrevention: {
    // Track processed event IDs
    trackProcessedEvents: true,
    // How long to remember event IDs (24 hours)
    eventIdTTL: 24 * 60 * 60 * 1000,
  },

  /**
   * Retry handling
   */
  retryHandling: {
    // Return 200 even on processing errors to prevent retries
    return200OnError: false,
    // Maximum processing time before timeout
    maxProcessingTimeMs: 30000, // 30 seconds
  },
};

/**
 * Rate Limiting Configuration
 * For protecting against abuse
 */
export const RATE_LIMITING = {
  /**
   * API endpoint limits
   */
  endpoints: {
    createPaymentIntent: {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10,
    },
    confirmPayment: {
      windowMs: 60 * 1000,
      maxRequests: 5,
    },
    listPaymentMethods: {
      windowMs: 60 * 1000,
      maxRequests: 30,
    },
  },

  /**
   * User-level limits
   */
  perUser: {
    paymentsPerHour: 20,
    paymentsPerDay: 100,
  },

  /**
   * IP-level limits (for unauthenticated requests)
   */
  perIP: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
};

/**
 * Negative Balance Management
 * Defines liability and handling procedures
 */
export const NEGATIVE_BALANCE_POLICY = {
  /**
   * Default liability
   */
  defaultLiability: 'platform' as const, // 'platform' | 'connected_account'

  /**
   * Thresholds for action
   */
  thresholds: {
    // Alert when negative balance exceeds this
    alertThreshold: 100, // USD
    // Suspend account when exceeds this
    suspendThreshold: 500, // USD
    // Automatic collection threshold
    collectionThreshold: 1000, // USD
  },

  /**
   * Resolution procedures
   */
  resolution: {
    // Attempt to collect from connected account first
    tryConnectedAccountFirst: true,
    // Days before escalating to collections
    escalationDays: 30,
    // Enable automatic debit from bank account
    automaticDebit: false,
  },

  /**
   * Monitoring
   */
  monitoring: {
    // Check for negative balances daily
    checkFrequency: 'daily',
    // Send alerts to these emails
    alertEmails: ['finance@bountyexpo.com'],
  },
};

/**
 * Security headers helper
 * Generate security headers for payment endpoints
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': generateCSPHeader(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'payment=(self), geolocation=()',
  };
}

/**
 * Validate payment request security
 */
export function validatePaymentSecurity(request: {
  protocol?: string;
  amount: number;
  userAgent?: string;
}): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check HTTPS
  if (!validateTLSConnection(request.protocol)) {
    errors.push('HTTPS is required for payment processing');
  }

  // Check amount validity
  if (request.amount <= 0) {
    errors.push('Amount must be positive');
  }

  // Check for minimum amount (Stripe requirement)
  if (request.amount < 0.50) {
    errors.push('Amount must be at least $0.50');
  }

  // Check user agent (detect bots/scrapers)
  if (request.userAgent) {
    const suspiciousUserAgents = ['bot', 'crawler', 'spider', 'scraper'];
    const isSuspicious = suspiciousUserAgents.some(pattern => 
      request.userAgent!.toLowerCase().includes(pattern)
    );
    if (isSuspicious) {
      warnings.push('Suspicious user agent detected');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Export all configuration
 */
export const PAYMENT_SECURITY_CONFIG = {
  csp: STRIPE_CSP_DIRECTIVES,
  tls: TLS_REQUIREMENTS,
  sca: SCA_CONFIG,
  pci: PCI_COMPLIANCE,
  radar: RADAR_CONFIG,
  idempotency: IDEMPOTENCY_CONFIG,
  webhooks: WEBHOOK_CONFIG,
  rateLimiting: RATE_LIMITING,
  negativeBalance: NEGATIVE_BALANCE_POLICY,
};
