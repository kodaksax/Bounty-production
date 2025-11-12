/**
 * Rate Limiting Middleware for API endpoints
 * Implements a simple in-memory token bucket algorithm
 * Rate limit: 100 requests per minute per user
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from './auth';

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

// In-memory store for rate limiting
// In production, use Redis or similar distributed cache
const rateLimitStore = new Map<string, RateLimitBucket>();

// Configuration
const MAX_TOKENS = 100; // Maximum requests per window
const REFILL_RATE = 100; // Tokens to add per window
const WINDOW_MS = 60 * 1000; // 1 minute window

/**
 * Get or create rate limit bucket for a user/IP
 */
function getBucket(key: string): RateLimitBucket {
  let bucket = rateLimitStore.get(key);
  
  if (!bucket) {
    bucket = {
      tokens: MAX_TOKENS,
      lastRefill: Date.now(),
    };
    rateLimitStore.set(key, bucket);
  }
  
  return bucket;
}

/**
 * Refill tokens based on time elapsed
 */
function refillBucket(bucket: RateLimitBucket): void {
  const now = Date.now();
  const timeSinceLastRefill = now - bucket.lastRefill;
  
  if (timeSinceLastRefill >= WINDOW_MS) {
    const windowsPassed = Math.floor(timeSinceLastRefill / WINDOW_MS);
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + (REFILL_RATE * windowsPassed));
    bucket.lastRefill = now;
  }
}

/**
 * Try to consume a token from the bucket
 * Returns true if request is allowed, false if rate limited
 */
function tryConsumeToken(bucket: RateLimitBucket): boolean {
  refillBucket(bucket);
  
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return true;
  }
  
  return false;
}

/**
 * Calculate seconds until next token refill
 */
function getRetryAfter(bucket: RateLimitBucket): number {
  const timeSinceLastRefill = Date.now() - bucket.lastRefill;
  const timeUntilRefill = WINDOW_MS - timeSinceLastRefill;
  return Math.ceil(timeUntilRefill / 1000);
}

/**
 * Rate limiting middleware
 * Limits requests per user (authenticated) or IP (unauthenticated)
 */
export async function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // Get identifier (userId if authenticated, IP if not)
    const authenticatedRequest = request as AuthenticatedRequest;
    const identifier = authenticatedRequest.userId || 
                      request.ip || 
                      'anonymous';
    
    const bucket = getBucket(identifier);
    const allowed = tryConsumeToken(bucket);
    
    // Add rate limit headers
    reply.header('X-RateLimit-Limit', MAX_TOKENS.toString());
    reply.header('X-RateLimit-Remaining', Math.max(0, bucket.tokens).toString());
    reply.header('X-RateLimit-Reset', (bucket.lastRefill + WINDOW_MS).toString());
    
    if (!allowed) {
      const retryAfter = getRetryAfter(bucket);
      reply.header('Retry-After', retryAfter.toString());
      
      return reply.code(429).send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      });
    }
  } catch (error) {
    // If rate limiting fails, allow the request but log the error
    console.error('Rate limiting error:', error);
  }
}

/**
 * Clean up old entries from rate limit store
 * Call this periodically to prevent memory leaks
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  const maxAge = WINDOW_MS * 2; // Keep entries for 2 windows
  
  for (const [key, bucket] of rateLimitStore.entries()) {
    if (now - bucket.lastRefill > maxAge && bucket.tokens === MAX_TOKENS) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean up every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
