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
   * IMPORTANT: In production, replace 'unsafe-inline' with nonces
   * Example: "'nonce-{random-value}'" generated per-request
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/style-src
   */
  'style-src': [
    "'self'",
    // TODO (Post-Launch): Replace with nonces in production for XSS prevention
    // Generate unique nonce per request: crypto.randomBytes(16).toString('base64')
    // Add to inline styles: <style nonce="{nonce}">
    // For now, unsafe-inline is used for development only
    ...(process.env.NODE_ENV === 'production' ? [] : ["'unsafe-inline'"]),
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
 * For fraud prevention and risk management on the BountyExpo P2P gig marketplace
 *
 * Radar risk model context:
 * - P2P marketplace with escrow: funds are held on bounty creation and
 *   released on completion. Chargebacks after release are costly.
 * - Common attack vectors: card testing (many small charges), stolen-card
 *   top-ups followed by fast withdrawal, bust-out by first-time high-value
 *   customers, and geo-mismatched IP/card pairs.
 * - Primary operating region is US / Canada / UK / EU / AU-NZ. Payments from
 *   outside that footprint are rare and warrant additional scrutiny.
 *
 * All `rules` and `customRules` entries below are the authoritative source of
 * truth for which Radar rules must be configured in the Stripe Dashboard
 * (Dashboard → Radar → Rules). Keep this file and the Dashboard in sync.
 *
 * @see https://stripe.com/docs/radar
 * @see https://stripe.com/docs/radar/rules
 * @see https://stripe.com/docs/radar/lists
 */
export const RADAR_CONFIG = {
  /**
   * Enable Radar for fraud detection
   * Note: Requires Radar to be enabled in Stripe Dashboard
   */
  enabled: true,

  /**
   * Risk thresholds (0-100, aligned with Stripe's `risk_score`)
   * These mirror the thresholds that should be configured on the
   * Dashboard → Radar → Rules page.
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
   * Platform-wide rule toggles. Each flag maps to one or more custom rules
   * in `customRules` below and/or to a Stripe built-in rule that must be
   * enabled in the Dashboard.
   */
  rules: {
    // Block payments from high-risk / sanctioned countries
    blockHighRiskCountries: true,
    // Require 3DS for high-value transactions (see SCA_CONFIG thresholds)
    require3DSHighValue: true,
    // Block if IP doesn't match billing country (kept as review to avoid
    // false positives from VPN / traveling legitimate users)
    blockIPMismatch: false,
    // Limit transaction velocity (card / customer / IP)
    velocityChecks: true,
    // Block anonymous proxy / Tor / known-bad IPs
    blockAnonymousProxy: true,
    // Flag disposable / throwaway email domains for review
    flagDisposableEmail: true,
    // Card testing protection: block bursts of small declines from one source
    blockCardTesting: true,
    // Enforce CVC and postal/ZIP checks when available
    requireCvcCheck: true,
    requirePostalCheck: true,
  },

  /**
   * Country lists
   *
   * `blockedCountries` mirrors the Stripe "Blocklist: countries" list and
   * should be kept consistent with US OFAC / EU sanctions guidance. Add a
   * country here AND to the Dashboard blocklist.
   *
   * `reviewCountries` are routed to manual review rather than blocked
   * outright.
   *
   * `allowedCountries` documents our primary operating footprint. Payments
   * from outside this list are not automatically blocked but are eligible
   * for stricter custom rules (see `customRules` below).
   *
   * Country codes are ISO 3166-1 alpha-2.
   */
  countryLists: {
    // Comprehensive sanctions / extreme-risk block list. Update whenever
    // sanctions guidance changes.
    blockedCountries: [
      'IR', // Iran
      'KP', // North Korea
      'SY', // Syria
      'CU', // Cuba
      'RU', // Russia
      'BY', // Belarus
      'MM', // Myanmar / Burma
      'SD', // Sudan
      'SS', // South Sudan
      'VE', // Venezuela (sanctioned entities)
      'AF', // Afghanistan (post-2021 sanctions)
    ],
    // Elevated-risk countries routed to manual review
    reviewCountries: [
      'NG', // Nigeria
      'PK', // Pakistan
      'BD', // Bangladesh
      'ID', // Indonesia
      'RO', // Romania
      'UA', // Ukraine
      'PH', // Philippines
      'VN', // Vietnam
    ],
    // Primary operating footprint
    allowedCountries: [
      'US', 'CA', 'GB', 'IE',
      'AU', 'NZ',
      'DE', 'FR', 'NL', 'ES', 'IT', 'PT', 'BE', 'AT', 'FI', 'SE', 'DK', 'NO',
      'CH', 'LU', 'PL', 'CZ',
    ],
  },

  /**
   * Allow / Block lists
   *
   * These document the Stripe "Lists" (Dashboard → Radar → Lists) that
   * custom rules reference. Runtime code does NOT read these values; they
   * are documentation of what must be maintained on the Dashboard.
   *
   * @see https://stripe.com/docs/radar/lists
   */
  lists: {
    // Email addresses / domains / fingerprints / cards previously tied to
    // confirmed fraud on this platform. Maintained by the Trust & Safety team.
    blockList: {
      emails: 'radar_block_emails',                 // list name in Dashboard
      emailDomains: 'radar_block_email_domains',
      cardFingerprints: 'radar_block_card_fingerprints',
      ipAddresses: 'radar_block_ips',
    },
    // Trusted customers (internal test accounts, high-trust partners).
    // Entries on this list bypass review rules but NOT block rules.
    allowList: {
      emails: 'radar_allow_emails',
      customerIds: 'radar_allow_customer_ids',
    },
    // Disposable / throwaway email domains flagged for review.
    disposableEmailDomains: 'radar_disposable_email_domains',
  },

  /**
   * Amount thresholds (USD) specific to BountyExpo's marketplace. These
   * feed the `customRules` below. Values are chosen to align with typical
   * bounty sizes on the platform (median posting is ~$25-$100).
   */
  amountThresholds: {
    // Bounties above this are unusual and get extra scrutiny
    unusualAmount: 500,
    // Bounties at or above this are high-value (require 3DS + review)
    highValueAmount: 1000,
    // Bounties at or above this are blocked outright for first-time customers
    firstTimeBlockAmount: 2000,
  },

  /**
   * Velocity thresholds. Mirror these in the corresponding Dashboard rules.
   *
   * Note: Stripe Radar's native aggregation windows are `_hourly` and
   * `_daily` (there is no native 10-minute window), so velocity rules below
   * use the `_hourly` aggregates.
   */
  velocity: {
    // Max payment attempts per card+IP in 1 hour before blocking (card testing)
    cardAttemptsPerHour: 10,
    // Max payment attempts per IP in 1 hour
    ipAttemptsPerHour: 20,
    // Max successful payments per customer in 1 hour
    customerPaymentsPerHour: 10,
    // Max successful payments per customer in 24 hours
    customerPaymentsPerDay: 30,
  },

  /**
   * Custom rules
   *
   * Each entry corresponds to a rule that MUST be created in
   * Stripe Dashboard → Radar → Rules. Conditions use Stripe's Radar rule
   * syntax. Keep this list and the Dashboard in sync; this file is the
   * source of truth for PR review.
   *
   * @see https://stripe.com/docs/radar/rules/reference
   */
  customRules: [
    // --- Block rules -------------------------------------------------------
    {
      name: 'Block payments from sanctioned / high-risk countries',
      condition:
        ":card_country: in ('IR','KP','SY','CU','RU','BY','MM','SD','SS','VE','AF') " +
        "OR :ip_country: in ('IR','KP','SY','CU','RU','BY','MM','SD','SS','VE','AF')",
      action: 'block',
    },
    {
      name: 'Block anonymous proxy / Tor / known-bad IP',
      condition: ':is_anonymous_ip:',
      action: 'block',
    },
    {
      name: 'Block card testing (≥10 declines per card+IP in 1 hour)',
      condition: ':card_count_for_ip_hourly: > 10 AND :is_declined:',
      action: 'block',
    },
    {
      name: 'Block high-value first-time customer',
      condition:
        'amount_in_usd >= 2000 AND :card_count_for_customer_all_time: = 0',
      action: 'block',
    },
    {
      name: 'Block when Radar risk_score ≥ 85',
      condition: ':risk_score: >= 85',
      action: 'block',
    },
    {
      name: 'Block when email appears on internal block list',
      condition: ':email: in @radar_block_emails',
      action: 'block',
    },
    {
      name: 'Block when card fingerprint appears on internal block list',
      condition: ':card_fingerprint: in @radar_block_card_fingerprints',
      action: 'block',
    },
    {
      name: 'Block when CVC check fails',
      condition: ":cvc_check: = 'fail'",
      action: 'block',
    },

    // --- Review rules ------------------------------------------------------
    {
      name: 'Review payments from elevated-risk countries',
      condition:
        ":card_country: in ('NG','PK','BD','ID','RO','UA','PH','VN') " +
        "OR :ip_country: in ('NG','PK','BD','ID','RO','UA','PH','VN')",
      action: 'review',
    },
    {
      name: 'Review when billing country does not match IP country',
      condition: ':ip_country: != :card_country:',
      action: 'review',
    },
    {
      name: 'Review when Radar risk_score between 65 and 85',
      condition: ':risk_score: >= 65 AND :risk_score: < 85',
      action: 'review',
    },
    {
      name: 'Review unusual amount (> $500) for the platform',
      condition: 'amount_in_usd > 500',
      action: 'review',
    },
    {
      name: 'Review high-value bounty (≥ $1000) — requires 3DS',
      condition: 'amount_in_usd >= 1000',
      action: 'review',
    },
    {
      name: 'Review disposable / throwaway email domains',
      condition: ':email_domain: in @radar_disposable_email_domains',
      action: 'review',
    },
    {
      name: 'Review high velocity per customer (>10 payments in 1 hour)',
      condition: ':total_count_for_customer_hourly: > 10',
      action: 'review',
    },
    {
      name: 'Review high velocity per IP (>20 attempts in 1 hour)',
      condition: ':total_count_for_ip_hourly: > 20',
      action: 'review',
    },
    {
      name: 'Review postal/ZIP check failures',
      condition: ":zip_check: = 'fail'",
      action: 'review',
    },

    // --- Allow rules (narrow, explicit) -----------------------------------
    {
      name: 'Allow trusted internal customers on allow-list',
      condition: ':customer: in @radar_allow_customer_ids',
      action: 'allow',
    },

    // --- 3D Secure rules --------------------------------------------------
    {
      name: 'Request 3DS for high-value transactions (≥ $250)',
      condition: 'amount_in_usd >= 250',
      action: 'request_3ds',
    },
    {
      name: 'Request 3DS for first-time customers',
      condition: ':card_count_for_customer_all_time: = 0',
      action: 'request_3ds',
    },
    {
      name: 'Request 3DS for all European cards (PSD2 / SCA)',
      condition:
        ":card_country: in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI'," +
        "'FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT'," +
        "'RO','SK','SI','ES','SE','IS','LI','NO','GB')",
      action: 'request_3ds',
    },
  ],

  /**
   * Review of Stripe's default fraud block / allow lists
   *
   * Stripe Radar ships with a default set of built-in block rules (e.g.
   * "Block if CVC check fails", "Block if Radar risk level is 'highest'")
   * and no default allow rules. We have audited the defaults and made the
   * following decisions — these should also be reflected in the Dashboard:
   *
   *   ✔ Keep enabled: "Block if Radar risk level is 'highest'"
   *   ✔ Keep enabled: "Block if CVC check fails" (duplicated explicitly above)
   *   ✔ Keep enabled: "Block if card is disposable" (virtual-card lists)
   *   ✔ Keep enabled: "Review if Radar risk level is 'elevated'"
   *   ✘ Do NOT auto-block on zip_check failure — US AVS is noisy; we route
   *     these to review instead (see custom rule above).
   *   ✘ Do NOT enable "Block if email appears risky" without a review step;
   *     we prefer to route suspicious emails through the disposable-email
   *     review rule so humans can triage.
   *
   * Default allow lists: Stripe does not ship with any default allow rules.
   * We only allow the narrow internal-customer list documented above.
   */
  defaultListsReview: {
    reviewedAt: '2026-04-21',
    keepEnabled: [
      'block_if_risk_level_is_highest',
      'block_if_cvc_check_fails',
      'block_if_card_is_disposable',
      'review_if_risk_level_is_elevated',
    ],
    overridden: [
      // Stripe default would auto-block on zip_check failure; we route to review.
      'block_if_zip_check_fails',
      // Stripe default "risky email" auto-block disabled in favor of review.
      'block_if_email_is_risky',
    ],
    allowListPolicy:
      'Only the internal `radar_allow_customer_ids` list bypasses review rules. ' +
      'No allow rule bypasses block rules.',
  },
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
    // Send alerts to configured email addresses
    // Set via NEGATIVE_BALANCE_ALERT_EMAILS environment variable (comma-separated)
    alertEmails: (process.env.NEGATIVE_BALANCE_ALERT_EMAILS || 'finance@bountyexpo.com').split(',').map((e: string) => e.trim()),
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
