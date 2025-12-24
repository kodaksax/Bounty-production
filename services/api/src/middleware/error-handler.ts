/**
 * Unified Error Handling
 * Provides consistent error responses and logging across all endpoints
 */

import { FastifyRequest, FastifyReply, FastifyError } from 'fastify';

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: string;
  message: string;
  code: string;
  details?: any;
  timestamp: string;
  requestId?: string;
}

/**
 * Error categories for better handling and metrics
 */
export enum ErrorCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  NOT_FOUND = 'not_found',
  CONFLICT = 'conflict',
  RATE_LIMIT = 'rate_limit',
  EXTERNAL_SERVICE = 'external_service',
  DATABASE = 'database',
  INTERNAL = 'internal',
}

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly category: ErrorCategory,
    public readonly details?: any,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Predefined error classes for common scenarios
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', details?: any) {
    super(
      message,
      401,
      'AUTHENTICATION_REQUIRED',
      ErrorCategory.AUTHENTICATION,
      details
    );
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', details?: any) {
    super(
      message,
      403,
      'AUTHORIZATION_FAILED',
      ErrorCategory.AUTHORIZATION,
      details
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(
      message,
      400,
      'VALIDATION_ERROR',
      ErrorCategory.VALIDATION,
      details
    );
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      `${resource}${identifier ? ` with identifier ${identifier}` : ''} not found`,
      404,
      'RESOURCE_NOT_FOUND',
      ErrorCategory.NOT_FOUND,
      { resource, identifier }
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(
      message,
      409,
      'CONFLICT',
      ErrorCategory.CONFLICT,
      details
    );
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super(
      message,
      429,
      'RATE_LIMIT_EXCEEDED',
      ErrorCategory.RATE_LIMIT,
      { retryAfter }
    );
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: any) {
    super(
      `External service error: ${service} - ${message}`,
      502,
      'EXTERNAL_SERVICE_ERROR',
      ErrorCategory.EXTERNAL_SERVICE,
      { service, ...details }
    );
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: any) {
    super(
      `Database error: ${message}`,
      500,
      'DATABASE_ERROR',
      ErrorCategory.DATABASE,
      details,
      true
    );
  }
}

/**
 * Format error response
 */
function formatErrorResponse(
  error: AppError | Error,
  request: FastifyRequest
): ErrorResponse {
  const isAppError = error instanceof AppError;
  
  return {
    error: isAppError ? error.name : 'Internal Server Error',
    message: error.message,
    code: isAppError ? error.code : 'INTERNAL_ERROR',
    details: isAppError && error.details ? error.details : undefined,
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };
}

/**
 * Determine if error should be logged as error or warn
 */
function shouldLogAsError(error: AppError | Error): boolean {
  if (error instanceof AppError) {
    // Operational errors are expected, log as warn
    // Non-operational errors are unexpected, log as error
    return !error.isOperational || error.statusCode >= 500;
  }
  // Unknown errors are always logged as error
  return true;
}

/**
 * Log error with appropriate level and context
 */
function logError(
  error: AppError | Error,
  request: FastifyRequest
): void {
  const logContext = {
    error: {
      message: error.message,
      name: error.name,
      stack: error.stack,
    },
    request: {
      id: request.id,
      method: request.method,
      url: request.url,
      userId: (request as any).userId,
    },
  };
  
  if (shouldLogAsError(error)) {
    request.log.error(logContext, 'Request error');
  } else {
    request.log.warn(logContext, 'Request warning');
  }
}

/**
 * Unified error handler for Fastify
 * Handles all errors thrown by route handlers
 */
export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  // Log the error
  logError(error, request);
  
  // Determine status code
  let statusCode = 500;
  if (error instanceof AppError) {
    statusCode = error.statusCode;
  } else if ('statusCode' in error && typeof error.statusCode === 'number') {
    statusCode = error.statusCode;
  }
  
  // Format error response
  const errorResponse = formatErrorResponse(error, request);
  
  // Send response
  reply.code(statusCode).send(errorResponse);
}

/**
 * Async error wrapper for route handlers
 * Catches errors and passes them to error handler
 */
export function asyncHandler<T = any>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<T | void> => {
    try {
      return await handler(request, reply);
    } catch (error) {
      // Let Fastify error handler process the error
      throw error;
    }
  };
}

/**
 * Validate and sanitize error for client
 * Removes sensitive information from error details
 */
export function sanitizeError(error: any): any {
  if (!error || typeof error !== 'object') return {};
  
  const sanitized: any = {};
  
  // Safe fields to include
  const safeFields = ['message', 'code', 'field', 'constraint', 'value'];
  
  for (const key of safeFields) {
    if (key in error) {
      sanitized[key] = error[key];
    }
  }
  
  return sanitized;
}

/**
 * Handle Zod validation errors
 */
export function handleZodError(error: any): ValidationError {
  if (error.name === 'ZodError' && error.issues) {
    const issues = error.issues.map((issue: any) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    
    return new ValidationError('Validation failed', { issues });
  }
  
  return new ValidationError('Validation failed');
}

/**
 * Handle database errors
 */
export function handleDatabaseError(error: any): AppError {
  // PostgreSQL error codes
  const pgErrorCodes: Record<string, () => AppError> = {
    '23505': () => new ConflictError('Duplicate entry', {
      constraint: error.constraint,
      detail: error.detail,
    }),
    '23503': () => new ValidationError('Foreign key constraint violation', {
      constraint: error.constraint,
      detail: error.detail,
    }),
    '23502': () => new ValidationError('Not null constraint violation', {
      column: error.column,
      detail: error.detail,
    }),
    '22001': () => new ValidationError('Value too long', {
      column: error.column,
      detail: error.detail,
    }),
  };
  
  const code = error.code?.toString();
  if (code && pgErrorCodes[code]) {
    return pgErrorCodes[code]();
  }
  
  // Generic database error
  return new DatabaseError(error.message, {
    code: error.code,
    detail: error.detail,
  });
}

/**
 * Handle Stripe errors
 */
export function handleStripeError(error: any): AppError {
  const type = error.type;
  
  switch (type) {
    case 'StripeCardError':
      return new ValidationError(error.message, {
        code: error.code,
        declineCode: error.decline_code,
      });
    
    case 'StripeRateLimitError':
      return new RateLimitError('Too many requests to payment processor');
    
    case 'StripeInvalidRequestError':
      return new ValidationError(error.message, {
        code: error.code,
        param: error.param,
      });
    
    case 'StripeAPIError':
      return new ExternalServiceError('Stripe', error.message, {
        code: error.code,
      });
    
    case 'StripeConnectionError':
      return new ExternalServiceError('Stripe', 'Connection failed', {
        message: error.message,
      });
    
    case 'StripeAuthenticationError':
      return new ExternalServiceError('Stripe', 'Authentication failed', {
        message: error.message,
      });
    
    default:
      return new ExternalServiceError('Stripe', error.message);
  }
}

/**
 * Handle Supabase errors
 */
export function handleSupabaseError(error: any): AppError {
  if (error.message?.includes('JWT')) {
    return new AuthenticationError('Invalid or expired token', {
      message: error.message,
    });
  }
  
  if (error.message?.includes('Row Level Security')) {
    return new AuthorizationError('Access denied', {
      message: error.message,
    });
  }
  
  if (error.code === 'PGRST116') {
    return new NotFoundError('Resource', undefined);
  }
  
  return new ExternalServiceError('Supabase', error.message, {
    code: error.code,
    details: error.details,
  });
}

/**
 * Generic error handler that determines error type
 */
export function handleError(error: any): AppError {
  // Already an AppError
  if (error instanceof AppError) {
    return error;
  }
  
  // Zod validation error
  if (error.name === 'ZodError') {
    return handleZodError(error);
  }
  
  // Database error
  if (error.code && typeof error.code === 'string') {
    if (error.code.startsWith('23') || error.code.startsWith('22')) {
      return handleDatabaseError(error);
    }
  }
  
  // Stripe error
  if (error.type && error.type.startsWith('Stripe')) {
    return handleStripeError(error);
  }
  
  // Supabase error
  if (error.message && typeof error.message === 'string') {
    if (error.message.includes('JWT') || error.message.includes('Supabase')) {
      return handleSupabaseError(error);
    }
  }
  
  // Generic error
  return new AppError(
    error.message || 'An unexpected error occurred',
    500,
    'INTERNAL_ERROR',
    ErrorCategory.INTERNAL,
    undefined,
    false
  );
}
