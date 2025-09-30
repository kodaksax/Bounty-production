import { FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for JWT verification
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

export interface AuthenticatedRequest extends FastifyRequest {
  userId?: string;
  user?: any;
}

// Auth middleware to verify Supabase JWT
export async function authMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ 
        error: 'Missing or invalid authorization header' 
      });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify JWT with Supabase
    const { data, error } = await supabase.auth.getUser(token);
    
    if (error || !data.user) {
      return reply.code(401).send({ 
        error: 'Invalid or expired token' 
      });
    }
    
    // Add user info to request
    request.userId = data.user.id;
    request.user = data.user;
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    return reply.code(500).send({ 
      error: 'Authentication service error' 
    });
  }
}

// Optional auth middleware (doesn't fail if no token)
export async function optionalAuthMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data } = await supabase.auth.getUser(token);
      
      if (data.user) {
        request.userId = data.user.id;
        request.user = data.user;
      }
    }
  } catch (error) {
    // Silently fail for optional auth
    console.log('Optional auth failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}
