/**
 * Security Module - Central export for all security utilities
 * 
 * This module provides:
 * - Input sanitization (XSS prevention, injection protection)
 * - Data encryption (E2E messaging, secure storage)
 * - Secure storage wrapper (SecureStore for sensitive data)
 * - Payment security configuration
 */

// Input sanitization
export {
  sanitizeHTML,
  sanitizeText,
  sanitizeEmail,
  sanitizeURL,
  sanitizeFileName,
  sanitizeJSON,
  sanitizeSearchQuery,
  sanitizeNumber,
  sanitizePhoneNumber,
  sanitizeObject,
  sanitizeBountyData,
  sanitizeMessageData,
  sanitizeUserProfileData,
} from './input-sanitization';

// Encryption utilities
export {
  generateEncryptionKey,
  generateIV,
  hashData,
  obfuscateData,
  deobfuscateData,
  encryptMessage,
  decryptMessage,
  generateKeyPair,
  signData,
  verifySignature,
  encryptForStorage,
  decryptFromStorage,
  isEncryptionAvailable,
  uint8ToBase64,
  base64ToUint8,
  type EncryptedMessage,
  type EncryptedStorage,
} from './encryption-utils';

// Secure storage
export {
  SecureStorage,
  DataSensitivity,
  storeAuthToken,
  getAuthToken,
  removeAuthToken,
  storeEncryptionKey,
  getEncryptionKey,
  storeCredentials,
  getCredentials,
  storeSensitiveProfile,
  getSensitiveProfile,
  storePreferences,
  getPreferences,
  isSecureStorageAvailable,
  getStorageRecommendation,
  identifyMigrationCandidates,
} from './secure-storage';

// Payment security configuration
export {
  STRIPE_CSP_DIRECTIVES,
  generateCSPHeader,
  TLS_REQUIREMENTS,
  validateTLSConnection,
  SCA_CONFIG,
  isSCARequired,
  PCI_COMPLIANCE,
  RADAR_CONFIG,
  IDEMPOTENCY_CONFIG,
  WEBHOOK_CONFIG,
  RATE_LIMITING,
  NEGATIVE_BALANCE_POLICY,
  PAYMENT_SECURITY_CONFIG,
  getSecurityHeaders,
  validatePaymentSecurity,
} from './payment-security-config';

/**
 * Security best practices documentation
 * 
 * ## Data Classification
 * 
 * ### Critical (Always use SecureStore)
 * - Authentication tokens
 * - Encryption keys
 * - Passwords
 * - Private keys
 * - API keys
 * 
 * ### Sensitive (Use SecureStore)
 * - Personal Identifiable Information (PII)
 * - Phone numbers
 * - Email addresses
 * - Physical addresses
 * - Payment information
 * - Social Security Numbers
 * 
 * ### Public (Can use AsyncStorage)
 * - UI preferences (theme, language)
 * - Cached public data
 * - Non-sensitive settings
 * - Analytics preferences
 * 
 * ## Input Sanitization
 * 
 * Always sanitize user input before:
 * - Storing in database
 * - Displaying to other users
 * - Using in API calls
 * - Processing in business logic
 * 
 * Example:
 * ```typescript
 * import { sanitizeBountyData } from '@/lib/security';
 * 
 * const userInput = {
 *   title: '<script>alert("xss")</script>My Bounty',
 *   description: 'Help me with this task...',
 *   amount: '100.50'
 * };
 * 
 * const sanitized = sanitizeBountyData(userInput);
 * // sanitized.title = "My Bounty" (script tags removed)
 * ```
 * 
 * ## E2E Encryption
 * 
 * For production messaging, use a proper E2E library:
 * - Signal Protocol (libsignal-protocol-javascript)
 * - Matrix Olm/Megolm (@privacyresearch/olm)
 * 
 * Current implementation provides basic encryption suitable for:
 * - Local data encryption
 * - Simple message encryption
 * 
 * Example:
 * ```typescript
 * import { encryptMessage, decryptMessage, generateKeyPair } from '@/lib/security';
 * 
 * // Generate keys for each user
 * const aliceKeys = await generateKeyPair();
 * const bobKeys = await generateKeyPair();
 * 
 * // Alice encrypts a message for Bob
 * const encrypted = await encryptMessage('Hello Bob!', bobKeys.publicKey);
 * 
 * // Bob decrypts the message
 * const plaintext = await decryptMessage(encrypted, bobKeys.privateKey);
 * ```
 * 
 * ## Secure Storage
 * 
 * Use the SecureStorage wrapper for type-safe sensitive data storage:
 * 
 * ```typescript
 * import { SecureStorage, DataSensitivity } from '@/lib/security';
 * 
 * // Store auth token (critical)
 * await SecureStorage.setItem('auth_token', token, DataSensitivity.CRITICAL);
 * 
 * // Store user preferences (public)
 * await SecureStorage.setJSON('preferences', { theme: 'dark' }, DataSensitivity.PUBLIC);
 * 
 * // Retrieve
 * const token = await SecureStorage.getItem('auth_token', DataSensitivity.CRITICAL);
 * ```
 * 
 * ## API Security
 * 
 * Ensure all API calls:
 * - Use HTTPS (TLS 1.2+)
 * - Include authentication tokens
 * - Validate SSL certificates
 * - Implement rate limiting
 * - Sanitize all inputs
 * 
 * ## Payment Security
 * 
 * Follow PCI-DSS compliance guidelines:
 * - Never store full card numbers
 * - Never store CVV/CVC codes
 * - Use Stripe.js for tokenization
 * - Implement Strong Customer Authentication (SCA)
 * - Use secure webhook signature verification
 * 
 * See payment-security-config.ts for detailed configuration.
 */

/**
 * Quick security checklist for developers
 */
export const SECURITY_CHECKLIST = {
  authentication: [
    'Use SecureStore for auth tokens',
    'Implement token refresh',
    'Handle session expiration',
    'Clear tokens on logout',
  ],
  
  data_storage: [
    'Classify data by sensitivity',
    'Use SecureStore for sensitive data',
    'Encrypt data at rest where needed',
    'Implement data retention policies',
  ],
  
  input_validation: [
    'Sanitize all user inputs',
    'Validate data types and formats',
    'Enforce length limits',
    'Check for injection attempts',
  ],
  
  api_security: [
    'Use HTTPS for all requests',
    'Validate SSL certificates',
    'Implement rate limiting',
    'Include auth tokens in headers',
  ],
  
  messaging: [
    'Consider E2E encryption for sensitive conversations',
    'Sanitize message content',
    'Implement message retention policies',
    'Verify sender identity',
  ],
  
  payments: [
    'Use Stripe.js for card tokenization',
    'Never store card details',
    'Implement SCA where required',
    'Verify webhook signatures',
  ],
};

/**
 * Security incident response
 */
export const SECURITY_INCIDENT_RESPONSE = {
  reporting: 'Email security@bountyexpo.com',
  
  immediate_actions: [
    'Identify affected systems',
    'Contain the incident',
    'Preserve evidence',
    'Notify affected users if data breach',
  ],
  
  investigation: [
    'Review audit logs',
    'Analyze attack vector',
    'Assess data exposure',
    'Document findings',
  ],
  
  remediation: [
    'Patch vulnerabilities',
    'Rotate compromised credentials',
    'Update security policies',
    'Implement additional controls',
  ],
  
  prevention: [
    'Conduct security training',
    'Review and update code',
    'Perform security audits',
    'Monitor for similar attacks',
  ],
};

export default {
  SECURITY_CHECKLIST,
  SECURITY_INCIDENT_RESPONSE,
};
