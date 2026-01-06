import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/database.types';
import { FastifyReply, FastifyRequest, type RouteGenericInterface } from 'fastify';
import { addUserContext } from './request-context';

// Initialize Supabase client for JWT verification - only if credentials are available
let supabase: ReturnType<typeof createClient<Database>> | null = null;

// Support both server-style env names and Expo public env names (fallback)
const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (supabaseUrl && supabaseAnon) {
  supabase = createClient<Database>(supabaseUrl, supabaseAnon)
  console.log('✅ Supabase auth client initialized')
} else {
  console.log('⚠️  Supabase credentials not found - auth middleware will be disabled')
}

export type AuthenticatedRequest<RouteGeneric extends RouteGenericInterface = RouteGenericInterface> = FastifyRequest<RouteGeneric> & {
  userId?: string;
  user?: any;
  isAdmin?: boolean;
}

// Rate limiting cache (in-memory, use Redis in production)
const rateLimitCache = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute

// Simple rate limiting
function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const cached = rateLimitCache.get(identifier);
  
  if (!cached || now > cached.resetAt) {
    rateLimitCache.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (cached.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  cached.count++;
  return true;
}

// Auth middleware to verify Supabase JWT
export async function authMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  try {
    // If no Supabase client, skip auth for testing
    if (!supabase) {
      console.log('⚠️  Auth middleware disabled - no Supabase credentials');
      request.userId = 'test-user-id';
      request.user = { id: 'test-user-id', email: 'test@example.com' };
      return;
    }

    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ 
        error: 'Missing or invalid authorization header',
        message: 'Please provide a valid Bearer token'
      });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Basic rate limiting based on token (first 10 chars)
    const rateLimitKey = token.substring(0, 10);
    if (!checkRateLimit(rateLimitKey)) {
      return reply.code(429).send({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.'
      });
    }
    
    // Verify JWT with Supabase
    const { data, error } = await supabase.auth.getUser(token);
    
    if (error) {
      // Provide specific error messages for different failure cases
      if (error.message.includes('expired')) {
        return reply.code(401).send({ 
          error: 'Token expired',
          message: 'Your session has expired. Please sign in again.'
        });
      }
      return reply.code(401).send({ 
        error: 'Invalid token',
        message: 'Authentication failed. Please sign in again.'
      });
    }
    
    if (!data.user) {
      return reply.code(401).send({ 
        error: 'User not found',
        message: 'Invalid authentication credentials'
      });
    }
    
    // Add user info to request
    request.userId = data.user.id;
    request.user = data.user;
    
    // Add user context to request context for logging
    addUserContext(request, data.user.id);
    
    // Check for admin role
    request.isAdmin = data.user.user_metadata?.role === 'admin' || 
                      data.user.app_metadata?.role === 'admin';
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    return reply.code(500).send({ 
      error: 'Authentication service error',
      message: 'Unable to verify authentication. Please try again.'
    });
  }
}

// Optional auth middleware (doesn't fail if no token)
export async function optionalAuthMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  try {
    // If no Supabase client, skip auth for testing
    if (!supabase) {
      return;
    }

    const authHeader = request.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data } = await supabase.auth.getUser(token);
      
      if (data.user) {
        request.userId = data.user.id;
        request.user = data.user;
        request.isAdmin = data.user.user_metadata?.role === 'admin' || 
                          data.user.app_metadata?.role === 'admin';
        
        // Add user context for optional auth too
        addUserContext(request, data.user.id);
      }
    }
  } catch (error) {
    // Silently fail for optional auth
    console.log('Optional auth failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}

// Admin-only middleware - requires auth and admin role
export async function adminMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  // First verify authentication
  await authMiddleware(request, reply);
  
  // If auth failed, authMiddleware already sent a response
  if (reply.sent) return;
  
  // Check for admin role
  if (!request.isAdmin) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'This resource requires administrator privileges'
    });
  }
}
