/**
 * Unified Authentication Middleware
 * Consolidates authentication logic from three separate backend services
 * Provides consistent Supabase JWT validation across all endpoints
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { Database } from '../types/database.types';
import { config } from '../config';

// Extend FastifyRequest to include authenticated user
export interface AuthenticatedRequest extends FastifyRequest {
  user?: User;
  userId?: string;
}

/**
 * Supabase admin client for JWT verification
 * Uses service role key to bypass RLS and verify tokens
 */
let supabaseAdmin: SupabaseClient<Database> | null = null;

function getSupabaseAdmin(): SupabaseClient<Database> {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient<Database>(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return supabaseAdmin;
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  
  return parts[1].trim();
}

/**
 * Verify JWT token with Supabase and extract user information
 */
async function verifyToken(token: string): Promise<{ user: User | null; error: Error | null }> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    
    if (error) {
      return { user: null, error: new Error(error.message) };
    }
    
    if (!data?.user) {
      return { user: null, error: new Error('User not found') };
    }
    
    return { user: data.user, error: null };
  } catch (error) {
    return {
      user: null,
      error: error instanceof Error ? error : new Error('Token verification failed'),
    };
  }
}

/**
 * Main authentication middleware
 * Validates JWT token and attaches user to request
 * 
 * Usage:
 * - Fastify: fastify.get('/protected', { preHandler: authMiddleware }, handler)
 * - Express: app.get('/protected', authMiddleware, handler)
 */
export async function authMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing authorization header',
        code: 'AUTH_HEADER_MISSING',
      });
      return;
    }
    
    const token = extractBearerToken(authHeader);
    
    if (!token) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid authorization header format. Expected: Bearer <token>',
        code: 'AUTH_HEADER_INVALID',
      });
      return;
    }
    
    const { user, error } = await verifyToken(token);
    
    if (error || !user) {
      request.log.warn({ error: error?.message }, 'Token verification failed');
      reply.code(401).send({
        error: 'Unauthorized',
        message: error?.message || 'Invalid or expired token',
        code: 'TOKEN_INVALID',
      });
      return;
    }
    
    // Attach user to request for downstream handlers
    request.user = user;
    request.userId = user.id;
    
    // Log successful authentication for audit trail
    request.log.debug({ userId: user.id, email: user.email }, 'User authenticated');
  } catch (error) {
    request.log.error({ error }, 'Authentication middleware error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Authentication failed',
      code: 'AUTH_FAILED',
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token is present and valid, but doesn't reject if missing
 * Useful for endpoints that have both authenticated and unauthenticated behavior
 */
export async function optionalAuthMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      // No auth header - continue without user
      return;
    }
    
    const token = extractBearerToken(authHeader);
    
    if (!token) {
      // Invalid format - continue without user
      return;
    }
    
    const { user, error } = await verifyToken(token);
    
    if (!error && user) {
      // Valid token - attach user
      request.user = user;
      request.userId = user.id;
      request.log.debug({ userId: user.id }, 'User authenticated (optional)');
    } else {
      // Invalid token - log but continue
      request.log.debug({ error: error?.message }, 'Optional auth failed, continuing unauthenticated');
    }
  } catch (error) {
    // Error during optional auth - log but continue
    request.log.warn({ error }, 'Optional authentication error, continuing unauthenticated');
  }
}

/**
 * Admin authentication middleware
 * Checks if user has admin role
 * Must be used after authMiddleware
 */
export async function adminAuthMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user || !request.userId) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    return;
  }
  
  // Check if user has admin role
  // This assumes user_metadata.role or app_metadata.role contains the role
  const userRole = request.user.user_metadata?.role || request.user.app_metadata?.role;
  
  if (userRole !== 'admin' && userRole !== 'super_admin') {
    request.log.warn({ userId: request.userId }, 'Admin access denied');
    reply.code(403).send({
      error: 'Forbidden',
      message: 'Admin privileges required',
      code: 'ADMIN_REQUIRED',
    });
    return;
  }
  
  request.log.info({ userId: request.userId, role: userRole }, 'Admin access granted');
}

/**
 * Rate limiting bypass for authenticated users with premium status
 * Can be used in combination with rate limiting middleware
 */
export function shouldBypassRateLimit(request: AuthenticatedRequest): boolean {
  if (!request.user) return false;
  
  // Check for premium/pro user metadata
  const isPremium = request.user.user_metadata?.is_premium || 
                   request.user.user_metadata?.subscription === 'pro';
  
  return !!isPremium;
}

/**
 * Express-compatible authentication middleware wrapper
 * For compatibility with legacy Express endpoints during migration
 * 
 * NOTE: This is a temporary solution during migration. Uses console.*
 * for logging as structured logger may not be available on Express req/res.
 * This wrapper will be removed after migration is complete.
 */
export function expressAuthMiddleware(req: any, res: any, next: any): void {
  const fastifyStyleRequest = {
    headers: req.headers,
    log: {
      warn: console.warn,
      error: console.error,
      debug: console.debug,
      info: console.info,
    },
  } as AuthenticatedRequest;
  
  const fastifyStyleReply = {
    code: (statusCode: number) => ({
      send: (body: any) => {
        res.status(statusCode).json(body);
      },
    }),
  } as FastifyReply;
  
  authMiddleware(fastifyStyleRequest, fastifyStyleReply)
    .then(() => {
      req.user = fastifyStyleRequest.user;
      req.userId = fastifyStyleRequest.userId;
      next();
    })
    .catch((error) => {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication failed',
      });
    });
}

/**
 * Validate user ownership of a resource
 * Useful for ensuring users can only access their own resources
 */
export function validateResourceOwnership(
  request: AuthenticatedRequest,
  resourceUserId: string
): boolean {
  if (!request.userId) return false;
  return request.userId === resourceUserId;
}

/**
 * Create service client for authenticated user
 * Returns a Supabase client with the user's JWT for RLS
 */
export function createUserSupabaseClient(request: AuthenticatedRequest): SupabaseClient | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;
  
  const token = extractBearerToken(authHeader);
  if (!token) return null;
  
  return createClient<Database>(
    config.supabase.url,
    config.supabase.anonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }
  );
}

/**
 * Test helper to create authenticated request for testing
 * Only use in test environment
 * 
 * NOTE: This creates a minimal mock with only user, userId, headers, and log.
 * It does not include other FastifyRequest properties like body, query, params,
 * method, url, etc. Tests using this helper should not access those properties.
 */
export function createTestAuthRequest(userId: string, email: string): AuthenticatedRequest {
  if (config.service.env === 'production') {
    throw new Error('createTestAuthRequest should not be used in production');
  }
  
  const mockUser: User = {
    id: userId,
    email,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
  
  return {
    user: mockUser,
    userId,
    headers: {},
    log: console,
  } as any;
}
