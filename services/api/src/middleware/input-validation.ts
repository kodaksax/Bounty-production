/**
 * Input Validation Middleware
 * 
 * Provides server-side validation and sanitization for all API inputs
 * This is a critical security layer - never trust client-side validation alone
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError, ZodSchema } from 'zod';

/**
 * Sanitization utilities (server-side versions)
 */

/**
 * Sanitize text input
 */
export function sanitizeText(input: string, maxLength: number = 10000): string {
  if (!input || typeof input !== 'string') return '';

  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');

  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Remove zero-width characters
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Trim and enforce max length
  return sanitized.trim().substring(0, maxLength);
}

/**
 * Sanitize HTML - strip all HTML tags
 */
export function sanitizeHTML(input: string): string {
  if (!input || typeof input !== 'string') return '';

  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*>/gi, '')
    .replace(/<link\b[^<]*>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/<[^>]+>/g, '');
}

/**
 * Sanitize email
 */
export function sanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';

  let sanitized = email.toLowerCase().trim();
  sanitized = sanitized.replace(/[^a-z0-9@.\-_+]/g, '');

  const atCount = (sanitized.match(/@/g) || []).length;
  if (atCount !== 1) return '';

  return sanitized;
}

/**
 * Sanitize URL
 */
export function sanitizeURL(url: string): string {
  if (!url || typeof url !== 'string') return '';

  const trimmed = url.trim();
  const lowerURL = trimmed.toLowerCase();

  // Block dangerous protocols
  const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
  for (const protocol of dangerousProtocols) {
    if (lowerURL.startsWith(protocol)) {
      return '';
    }
  }

  // Only allow http, https, and mailto
  if (!lowerURL.startsWith('http://') &&
    !lowerURL.startsWith('https://') &&
    !lowerURL.startsWith('mailto:')) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

/**
 * Zod schemas for common data types
 */

// Common amount validation (in cents)
export const amountCentsSchema = z.number()
  .int('Amount must be an integer (in cents)')
  .min(0, 'Amount cannot be negative')
  .max(1000000, 'Amount cannot exceed $10,000.00 (1,000,000 cents)');

// Common amount validation (in dollars)
export const amountDollarsSchema = z.number()
  .min(0, 'Amount cannot be negative')
  .max(10000, 'Amount cannot exceed $10,000.00');

// Bounty validation schema
export const bountySchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or less')
    .transform(val => sanitizeText(val, 200)),

  description: z.string()
    .min(1, 'Description is required')
    .max(5000, 'Description must be 5000 characters or less')
    .transform(val => sanitizeText(val, 5000)),

  amount: amountDollarsSchema.optional(),

  isForHonor: z.boolean().optional(),

  location: z.string()
    .max(500, 'Location must be 500 characters or less')
    .transform(val => sanitizeText(val, 500))
    .optional(),

  dueDate: z.string()
    .datetime()
    .optional(),

  category: z.string()
    .max(100)
    .optional(),
}).refine(data => {
  if (data.isForHonor) {
    return (data.amount || 0) === 0;
  }
  // Paid bounties must be at least $1
  if (data.amount !== undefined && data.amount < 1) {
    return false;
  }
  return true;
}, {
  message: 'Paid bounties must be at least $1.00, Honor bounties must be $0',
  path: ['amount']
});

// Message validation schema
export const messageSchema = z.object({
  text: z.string()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message must be 10,000 characters or less')
    .transform(val => sanitizeText(val, 10000)),

  conversationId: z.string()
    .uuid('Invalid conversation ID'),

  attachments: z.array(z.object({
    type: z.enum(['image', 'file', 'video']),
    url: z.string().url(),
    name: z.string().max(255),
  })).optional(),
});

// User profile validation schema
export const userProfileSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be 50 characters or less')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens')
    .transform(val => sanitizeText(val, 50)),

  displayName: z.string()
    .max(100, 'Display name must be 100 characters or less')
    .transform(val => sanitizeText(val, 100))
    .optional(),

  bio: z.string()
    .max(500, 'Bio must be 500 characters or less')
    .transform(val => sanitizeText(val, 500))
    .optional(),

  website: z.string()
    .url('Invalid website URL')
    .transform(val => sanitizeURL(val))
    .optional(),

  location: z.string()
    .max(100, 'Location must be 100 characters or less')
    .transform(val => sanitizeText(val, 100))
    .optional(),

  skills: z.array(z.string().max(50)).max(20).optional(),
});

// Payment intent validation schema
export const paymentIntentSchema = z.object({
  amount: amountCentsSchema,

  currency: z.string()
    .length(3, 'Currency must be a 3-letter code')
    .regex(/^[A-Z]{3}$/, 'Currency must be uppercase letters')
    .default('USD'),

  description: z.string()
    .max(500, 'Description must be 500 characters or less')
    .transform(val => sanitizeText(val, 500))
    .optional(),

  bountyId: z.string()
    .uuid('Invalid bounty ID')
    .optional(),
});

// Webhook validation schema
export const webhookSchema = z.object({
  type: z.string(),
  data: z.record(z.any()),
  created: z.number().int().positive(),
  livemode: z.boolean(),
});

/**
 * Generic validation middleware factory
 * 
 * Note: This modifies the request object to replace raw input with validated data.
 * Type safety is maintained through Fastify's request decoration mechanism.
 */
export function validateRequest<T extends ZodSchema>(
  schema: T,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request[source];
      const validated = await schema.parseAsync(data);

      // Replace the original data with validated/sanitized version
      // Using Object.assign to maintain type structure
      Object.assign(request[source] || {}, validated);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: 'Validation Error',
          message: 'Invalid input data',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      return reply.code(400).send({
        error: 'Validation Error',
        message: 'Invalid input data',
      });
    }
  };
}

/**
 * SQL Injection prevention
 * 
 * @deprecated This function should NOT be used. When using ORMs like Drizzle or parameterized queries,
 * SQL injection is prevented at the database layer. This function provides a false sense of security
 * and may encourage bypassing proper ORM usage.
 * 
 * Use the ORM's query builder or parameterized queries instead of manual string sanitization.
 * This function is marked as internal and will be removed in a future version.
 * 
 * @internal
 */
function preventSQLInjection_DEPRECATED_DO_NOT_USE(input: string): string {
  console.error('[Security] preventSQLInjection is DEPRECATED and should NOT be used. Use ORM parameterized queries instead.');

  if (!input || typeof input !== 'string') return '';

  // Remove null bytes and control characters
  let sanitized = input.replace(/\0/g, '');
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  return sanitized.trim();
}

/**
 * XSS prevention
 */
export function preventXSS(input: string): string {
  return sanitizeHTML(input);
}

/**
 * Path traversal prevention
 */
export function preventPathTraversal(path: string): string {
  if (!path || typeof path !== 'string') return '';

  // Remove path traversal attempts
  let sanitized = path.replace(/\.\.[\\/]/g, '');

  // Remove directory separators at the start
  sanitized = sanitized.replace(/^[\/\\]+/, '');

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  return sanitized;
}

/**
 * Command injection prevention
 */
export function preventCommandInjection(input: string): string {
  if (!input || typeof input !== 'string') return '';

  // Remove shell metacharacters
  return input.replace(/[;&|`$(){}[\]<>]/g, '');
}

/**
 * Rate limiting validation
 * 
 * ⚠️ WARNING: This in-memory implementation is suitable for development only.
 * 
 * Limitations:
 * - Lost on server restart
 * - Does not work across multiple server instances
 * - No persistence
 * 
 * For production, use:
 * - Redis (recommended): fast, distributed, persistent
 * - Database: persistent but slower
 * - API Gateway: handles rate limiting at edge
 */
export interface RateLimitInfo {
  identifier: string; // user ID, IP, etc.
  endpoint: string;
  limit: number;
  windowMs: number;
}

// In-memory store (dev/testing only)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(info: RateLimitInfo): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  // Log warning in production
  if (process.env.NODE_ENV === 'production') {
    console.warn('[RateLimit] Using in-memory rate limiting in production - consider Redis');
  }

  const key = `${info.identifier}:${info.endpoint}`;
  const now = Date.now();

  const existing = rateLimitStore.get(key);

  if (!existing || now > existing.resetAt) {
    // Create new window
    const resetAt = now + info.windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: info.limit - 1,
      resetAt,
    };
  }

  if (existing.count >= info.limit) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  // Increment count
  existing.count++;
  rateLimitStore.set(key, existing);

  return {
    allowed: true,
    remaining: info.limit - existing.count,
    resetAt: existing.resetAt,
  };
}

/**
 * Clean up expired rate limit entries (call periodically)
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup interval handle for lifecycle management
let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the rate limit cleanup process
 * Should be called when the server starts
 */
export function startRateLimitCleanup(): void {
  if (cleanupIntervalHandle) {
    console.warn('[RateLimit] Cleanup already running');
    return;
  }
  cleanupIntervalHandle = setInterval(cleanupRateLimits, 5 * 60 * 1000) as any;
  console.log('[RateLimit] Cleanup interval started');
}

/**
 * Stop the rate limit cleanup process
 * Should be called during graceful server shutdown
 */
export function stopRateLimitCleanup(): void {
  if (cleanupIntervalHandle) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
    console.log('[RateLimit] Cleanup interval stopped');
  }
}

/**
 * Validation helpers
 */

export const validators = {
  isEmail: (email: string): boolean => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  },

  isURL: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  isUUID: (id: string): boolean => {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return regex.test(id);
  },

  isAlphanumeric: (str: string): boolean => {
    return /^[a-zA-Z0-9]+$/.test(str);
  },

  isStrongPassword: (password: string): boolean => {
    // At least 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(password);
  },
};

/**
 * Content Security Policy helpers
 */
export function generateCSPHeader(): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'", // React Native requires unsafe-inline
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com wss:",
    "frame-src 'self' https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return directives.join('; ');
}

/**
 * Security headers middleware
 */
export async function securityHeadersMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Set security headers
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  // Note: X-XSS-Protection is deprecated and omitted - rely on CSP instead
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'payment=(self), geolocation=()');
  reply.header('Content-Security-Policy', generateCSPHeader());
}

// Note: Default export removed to encourage explicit named imports
// This improves code clarity and makes dependencies more obvious
