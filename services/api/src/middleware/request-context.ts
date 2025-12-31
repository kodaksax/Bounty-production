/**
 * Request Context Middleware
 * 
 * Adds structured context to all API requests for better observability:
 * - Request ID: Unique identifier for request tracing
 * - Environment: Current environment (development, production, etc.)
 * - User context: User ID (if authenticated)
 * - Timing: Request start time for duration tracking
 * 
 * The request context is available via `request.requestContext` and
 * automatically included in error logs and responses.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../services/logger';

// Extend Fastify request type to include our custom context
declare module 'fastify' {
  interface FastifyRequest {
    requestContext?: RequestContext;
  }
}

export interface RequestContext {
  requestId: string;
  environment: string;
  userId?: string;
  startTime: number;
  path: string;
  method: string;
}

/**
 * Generate cryptographically secure random string
 * Uses crypto.randomBytes in Node.js environment
 */
function generateSecureRandom(length: number = 8): string {
  try {
    // Node.js environment
    const crypto = require('crypto');
    const bytes = crypto.randomBytes(Math.ceil(length / 2));
    return bytes.toString('hex').slice(0, length);
  } catch (error) {
    // Fallback: timestamp-based (still unique but less secure)
    return Date.now().toString(36).slice(-length);
  }
}

/**
 * Generate a unique request ID
 * Format: req_<timestamp>_<random>
 * Uses cryptographically secure random in Node.js
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = generateSecureRandom(8);
  return `req_${timestamp}_${random}`;
}

/**
 * Request context middleware
 * Attaches request context to every request for tracing
 */
export async function requestContextMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Generate request ID (use existing if provided in header)
  const requestId = (request.headers['x-request-id'] as string) || generateRequestId();
  
  // Get environment from env var
  const environment = process.env.NODE_ENV || 'development';
  
  // Create request context
  const context: RequestContext = {
    requestId,
    environment,
    startTime: Date.now(),
    path: request.url,
    method: request.method,
  };
  
  // Attach to request
  request.requestContext = context;
  
  // Add request ID to response headers for client-side tracing
  reply.header('x-request-id', requestId);
  
  // Log request start (structured)
  logger.info({
    requestId,
    method: request.method,
    path: request.url,
    environment,
  }, '[request] Incoming request');
}

/**
 * Get request context from request
 * Returns context or creates minimal fallback
 */
export function getRequestContext(request: FastifyRequest): RequestContext {
  if (request.requestContext) {
    return request.requestContext;
  }
  
  // Fallback if middleware hasn't run
  return {
    requestId: generateRequestId(),
    environment: process.env.NODE_ENV || 'development',
    startTime: Date.now(),
    path: request.url,
    method: request.method,
  };
}

/**
 * Add user context to request context (called after authentication)
 */
export function addUserContext(request: FastifyRequest, userId: string): void {
  if (request.requestContext) {
    request.requestContext.userId = userId;
  }
}

/**
 * Get duration since request started
 */
export function getRequestDuration(request: FastifyRequest): number {
  const context = getRequestContext(request);
  return Date.now() - context.startTime;
}

/**
 * Create structured error log with full context
 */
export function logErrorWithContext(
  request: FastifyRequest,
  error: any,
  additionalContext?: Record<string, any>
): void {
  const context = getRequestContext(request);
  const duration = getRequestDuration(request);
  
  logger.error({
    requestId: context.requestId,
    environment: context.environment,
    userId: context.userId,
    method: context.method,
    path: context.path,
    duration,
    error: {
      message: error?.message || String(error),
      stack: error?.stack,
      code: error?.code,
      type: error?.type,
    },
    ...additionalContext,
  }, '[error] Request failed');
}

/**
 * Create structured success log with full context
 */
export function logSuccessWithContext(
  request: FastifyRequest,
  message: string,
  additionalContext?: Record<string, any>
): void {
  const context = getRequestContext(request);
  const duration = getRequestDuration(request);
  
  logger.info({
    requestId: context.requestId,
    environment: context.environment,
    userId: context.userId,
    method: context.method,
    path: context.path,
    duration,
    ...additionalContext,
  }, `[success] ${message}`);
}
