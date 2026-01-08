/**
 * Consolidated Authentication Routes
 * Unified authentication endpoints consolidating logic from multiple legacy servers
 * Migrated from:
 * - api/server.js (lines 202-282, 1184-1363)
 * - server/index.js (lines 152-202)
 */

import { createClient } from '@supabase/supabase-js';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { asyncHandler, AuthenticationError, ExternalServiceError, ValidationError } from '../middleware/error-handler';
import { AuthenticatedRequest, authMiddleware } from '../middleware/unified-auth';
import { Database } from '../types/database.types';
import { toJsonSchema } from '../utils/zod-json';
import { authLimiterConfig } from '../middleware/rate-limiter';

/**
 * Validation schemas using Zod
 */
const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(24, 'Username must be at most 24 characters').regex(/^[a-zA-Z0-9_]+$/, 'Username must contain only letters, numbers, and underscores').optional(),
});

const signInSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const signUpSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(24, 'Username must be at most 24 characters').regex(/^[a-zA-Z0-9_]+$/, 'Username must contain only letters, numbers, and underscores').optional(),
});

/**
 * Note: Rate limiting is now handled by Redis-backed @fastify/rate-limit
 * Configuration is imported from middleware/rate-limiter.ts
 * 
 * Old in-memory rate limiting has been replaced with distributed Redis-backed
 * rate limiting for better scalability across multiple server instances.
 */

/**
 * Supabase admin client singleton for user management operations
 * Reused across all requests to avoid repeated connection setup
 */
const supabaseAdminClient = createClient<Database>(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Get Supabase admin client for user management operations
 */
function getSupabaseAdmin(): ReturnType<typeof createClient<Database>> {
  return supabaseAdminClient;
}

/**
 * Shared user registration handler
 * Used by both /auth/register and /auth/sign-up endpoints
 */
async function handleUserRegistration(
  request: FastifyRequest,
  reply: FastifyReply,
  body: { email: string; password: string; username?: string },
  logPrefix: string
) {
  request.log.info(
    { email: body.email, hasUsername: !!body.username },
    `${logPrefix} attempt`
  );

  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    // Generate username from email if not provided
    // Add timestamp suffix to ensure uniqueness
    let username = body.username;
    if (!username) {
      const emailLocal = body.email.split('@')[0];
      const timestamp = Date.now().toString(36).slice(-4);
      username = `${emailLocal}_${timestamp}`;
    }

    // Create user in Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: body.email.trim(),
      password: body.password,
      email_confirm: true, // Auto-confirm email for immediate login
      user_metadata: { username },
    });

    if (error) {
      request.log.error(
        { error: error.message, email: body.email },
        'Supabase user creation failed'
      );

      // Check for duplicate email error
      if (error.message.includes('already registered') || error.message.includes('already exists')) {
        throw new ValidationError('Email already registered', { email: body.email });
      }

      throw new ExternalServiceError('Supabase', error.message, { code: error.code });
    }

    if (!data?.user?.id) {
      throw new ExternalServiceError('Supabase', 'User creation returned no user ID');
    }

    const userId = data.user.id;

    request.log.info(
      { userId, email: body.email, username },
      `${logPrefix} successful`
    );

    reply.code(201).send({
      success: true,
      userId,
      email: body.email,
      username,
      message: 'Account created successfully',
    });
  } catch (error) {
    // Re-throw AppErrors as-is, they'll be handled by error handler
    if (error instanceof ValidationError || error instanceof ExternalServiceError) {
      throw error;
    }
    
    // Wrap unexpected errors
    request.log.error({ error }, `Unexpected ${logPrefix} error`);
    throw new ExternalServiceError(logPrefix, 'Failed to create account', { 
      originalError: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}

/**
 * Register all consolidated authentication routes
 */
export async function registerConsolidatedAuthRoutes(
  fastify: FastifyInstance
): Promise<void> {
  
  // Register rate limiting plugin with auth-specific configuration
  // This creates a rate limiter that can be applied per-route
  await fastify.register(rateLimit, {
    global: false, // Don't apply globally, we'll use it per-route
    ...authLimiterConfig,
  });
  
  /**
   * POST /auth/register
   * Register a new user with email, password, and optional username
   * 
   * @body {string} email - User email address (required)
   * @body {string} password - User password, min 8 characters (required)
   * @body {string} username - Username (optional)
   * 
   * @returns {201} User created successfully
   * @returns {400} Validation error
   * @returns {409} Email or username already exists
   * @returns {429} Rate limit exceeded
   * @returns {500} Server error
   */
  fastify.post(
    '/auth/register',
    {
      config: {
        rateLimit: authLimiterConfig,
      },
      schema: {
        tags: ['auth'],
        description: 'Register a new user account',
        // Provide Fastify with JSON Schema converted from Zod
        body: toJsonSchema(registerSchema, 'AuthRegisterRequest'),
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              userId: { type: 'string' },
              email: { type: 'string' },
              username: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      const body = registerSchema.parse(request.body);
      await handleUserRegistration(request, reply, body, 'User registration');
    })
  );

  /**
   * POST /auth/sign-in
   * Sign in with email and password using Supabase Auth
   * 
   * @body {string} email - User email address (required)
   * @body {string} password - User password (required)
   * 
   * @returns {200} Sign-in successful, returns session and user data
   * @returns {400} Validation error
   * @returns {401} Invalid credentials
   * @returns {429} Rate limit exceeded
   * @returns {500} Server error
   */
  fastify.post(
    '/auth/sign-in',
    {
      config: {
        rateLimit: authLimiterConfig,
      },
      schema: {
        tags: ['auth'],
        description: 'Sign in with email and password',
        // Provide Fastify with JSON Schema converted from Zod
        body: toJsonSchema(signInSchema, 'AuthSignInRequest'),
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
              session: {
                type: 'object',
                properties: {
                  access_token: { type: 'string' },
                  refresh_token: { type: 'string' },
                  expires_in: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      const body = signInSchema.parse(request.body);

      request.log.info(
        { email: body.email },
        'User sign-in attempt'
      );

      try {
        // Sign in with Supabase (use regular client for sign-in, not admin)
        const supabaseClient = createClient<Database>(
          config.supabase.url,
          config.supabase.anonKey
        );

        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: body.email.trim(),
          password: body.password,
        });

        if (error) {
          request.log.warn(
            { email: body.email, error: error.message },
            'Sign-in failed'
          );

          // Don't reveal whether email exists or password is wrong
          throw new AuthenticationError('Invalid email or password');
        }

        if (!data.user || !data.session) {
          throw new AuthenticationError('Sign-in failed');
        }

        request.log.info(
          { userId: data.user.id, email: data.user.email },
          'User signed in successfully'
        );

        return {
          success: true,
          user: {
            id: data.user.id,
            email: data.user.email,
          },
          session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_in: data.session.expires_in,
          },
        };
      } catch (error) {
        if (error instanceof AuthenticationError) {
          throw error;
        }

        request.log.error({ error }, 'Unexpected sign-in error');
        throw new ExternalServiceError('Authentication', 'Sign-in failed', {
          originalError: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  /**
   * POST /auth/sign-up
   * Alternative sign-up endpoint (same as register but different route for compatibility)
   * 
   * @body {string} email - User email address (required)
   * @body {string} password - User password, min 8 characters (required)
   * @body {string} username - Username (optional)
   * 
   * @returns {201} User created successfully
   * @returns {400} Validation error
   * @returns {409} Email or username already exists
   * @returns {429} Rate limit exceeded
   * @returns {500} Server error
   */
  fastify.post(
    '/auth/sign-up',
    {
      config: {
        rateLimit: authLimiterConfig,
      },
      schema: {
        tags: ['auth'],
        description: 'Sign up for a new account (alternative endpoint)',
        // Provide Fastify with JSON Schema converted from Zod
        body: toJsonSchema(signUpSchema, 'AuthSignUpRequest'),
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              userId: { type: 'string' },
              email: { type: 'string' },
              username: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      const body = signUpSchema.parse(request.body);
      await handleUserRegistration(request, reply, body, 'User sign-up');
    })
  );

  /**
   * GET /auth/diagnostics
   * Health check endpoint for authentication service
   * Returns configuration status without exposing sensitive values
   * 
   * @returns {200} Auth service configuration status
   */
  fastify.get(
    '/auth/diagnostics',
    {
      schema: {
        tags: ['auth'],
        description: 'Check authentication service health and configuration',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              supabaseConfigured: { type: 'boolean' },
              urlPresent: { type: 'boolean' },
              serviceKeyPresent: { type: 'boolean' },
              anonKeyPresent: { type: 'boolean' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      request.log.info('Auth diagnostics requested');

      const diagnostics = {
        status: 'ok',
        supabaseConfigured: !!(config.supabase.url && config.supabase.serviceRoleKey),
        urlPresent: !!config.supabase.url,
        serviceKeyPresent: !!config.supabase.serviceRoleKey,
        anonKeyPresent: !!config.supabase.anonKey,
        timestamp: new Date().toISOString(),
      };

      return diagnostics;
    })
  );

  /**
   * GET /auth/ping
   * Test Supabase connectivity by attempting to list users
   * Verifies that the service role key is valid and API is accessible
   * 
   * @returns {200} Supabase connection successful
   * @returns {500} Supabase connection failed
   */
  fastify.get(
    '/auth/ping',
    {
      schema: {
        tags: ['auth'],
        description: 'Test Supabase connectivity and authentication',
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              message: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      request.log.info('Supabase ping requested');

      try {
        if (!config.supabase.url || !config.supabase.serviceRoleKey) {
          throw new ExternalServiceError(
            'Supabase',
            'Supabase admin client not configured'
          );
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Try to list users (limit to 1 to minimize load)
        const { error } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });

        if (error) {
          request.log.error(
            { error: error.message },
            'Supabase ping failed'
          );
          throw new ExternalServiceError('Supabase', error.message);
        }

        request.log.info('Supabase ping successful');

        return {
          ok: true,
          message: 'Supabase connection successful',
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof ExternalServiceError) {
          throw error;
        }

        request.log.error({ error }, 'Unexpected ping error');
        throw new ExternalServiceError('Supabase', 'Ping failed', {
          originalError: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  /**
   * DELETE /auth/delete-account
   * Delete the authenticated user's account
   * Requires valid authentication token
   * 
   * This endpoint performs comprehensive cleanup:
   * 1. Deletes completion submissions tied to the user
   * 2. Deletes bounty requests by the user
   * 3. Deletes bounties created by the user
   * 4. Deletes conversations and related data (messages, participants)
   * 5. Deletes the user from Supabase Auth (cascades to profiles if configured)
   * 6. Falls back to manual profile deletion if admin deletion fails
   * 
   * @header {string} Authorization - Bearer token (required)
   * 
   * @returns {200} Account deleted successfully
   * @returns {401} Authentication required
   * @returns {500} Deletion failed
   */
  fastify.delete(
    '/auth/delete-account',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['auth'],
        description: 'Delete the authenticated user account with comprehensive cleanup',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      request.log.info(
        { userId },
        'Account deletion requested'
      );

      try {
        const supabaseAdmin = getSupabaseAdmin();

        // Step 1: Delete completion submissions tied to this user as hunter
        try {
          const { error: compErr } = await supabaseAdmin
            .from('completion_submissions')
            .delete()
            .eq('hunter_id', userId);
          if (compErr) {
            request.log.warn(
              { userId, error: compErr.message },
              'completion_submissions cleanup failed (continuing)'
            );
          }
        } catch (error) {
          request.log.warn(
            { userId, error: error instanceof Error ? error.message : 'Unknown' },
            'completion_submissions cleanup threw (continuing)'
          );
        }

        // Step 2: Delete bounty requests by this user (hunter applications)
        try {
          const { error: reqErr } = await supabaseAdmin
            .from('bounty_requests')
            .delete()
            .eq('user_id', userId);
          if (reqErr) {
            request.log.warn(
              { userId, error: reqErr.message },
              'bounty_requests cleanup failed (continuing)'
            );
          }
        } catch (error) {
          request.log.warn(
            { userId, error: error instanceof Error ? error.message : 'Unknown' },
            'bounty_requests cleanup threw (continuing)'
          );
        }

        // Step 3: Delete bounties created by this user
        try {
          const { error: bntyErr } = await supabaseAdmin
            .from('bounties')
            .delete()
            .eq('poster_id', userId);
          if (bntyErr) {
            request.log.warn(
              { userId, error: bntyErr.message },
              'bounties cleanup failed (continuing)'
            );
          }
        } catch (error) {
          request.log.warn(
            { userId, error: error instanceof Error ? error.message : 'Unknown' },
            'bounties cleanup threw (continuing)'
          );
        }

        // Step 4: Delete conversations created by this user, with explicit child cleanup
        try {
          // Fetch conversation ids first
          const { data: convs, error: convListErr } = await supabaseAdmin
            .from('conversations')
            .select('id')
            .eq('created_by', userId);
          
          if (convListErr) {
            request.log.warn(
              { userId, error: convListErr.message },
              'conversations list failed (continuing)'
            );
          } else if (convs && convs.length > 0) {
            const ids = convs.map((c: any) => c.id);
            
            // Delete messages in those conversations
            const { error: msgErr } = await supabaseAdmin
              .from('messages')
              .delete()
              .in('conversation_id', ids);
            if (msgErr) {
              request.log.warn(
                { userId, error: msgErr.message },
                'messages deletion failed (continuing)'
              );
            }
            
            // Delete participants in those conversations
            const { error: partErr } = await supabaseAdmin
              .from('conversation_participants')
              .delete()
              .in('conversation_id', ids);
            if (partErr) {
              request.log.warn(
                { userId, error: partErr.message },
                'participants deletion failed (continuing)'
              );
            }
            
            // Finally delete the conversations
            const { error: convDelErr } = await supabaseAdmin
              .from('conversations')
              .delete()
              .in('id', ids);
            if (convDelErr) {
              request.log.warn(
                { userId, error: convDelErr.message },
                'conversations deletion failed (continuing)'
              );
            }
          }
          
          // Also remove any participant rows for this user in other conversations
          const { error: partUserErr } = await supabaseAdmin
            .from('conversation_participants')
            .delete()
            .eq('user_id', userId);
          if (partUserErr) {
            request.log.warn(
              { userId, error: partUserErr.message },
              'participant rows for user deletion failed (continuing)'
            );
          }
        } catch (error) {
          request.log.warn(
            { userId, error: error instanceof Error ? error.message : 'Unknown' },
            'conversations cascade deletion threw (continuing)'
          );
        }

        // Step 5: Delete auth user via admin API
        // This should cascade to profiles if FK is configured with ON DELETE CASCADE
        let adminDeleted = false;
        try {
          const { error: adminError } = await supabaseAdmin.auth.admin.deleteUser(userId);

          if (adminError) {
            request.log.warn(
              { userId, error: adminError.message },
              'Admin deleteUser failed, will try fallback'
            );
          } else {
            adminDeleted = true;
            request.log.info({ userId }, 'User deleted via admin API');
          }
        } catch (error) {
          request.log.warn(
            { userId, error: error instanceof Error ? error.message : 'Unknown' },
            'Admin deleteUser threw exception, will try fallback'
          );
        }

        // Step 6: Fallback to manual profile deletion if admin deletion failed
        if (!adminDeleted) {
          request.log.info({ userId }, 'Attempting fallback profile deletion');

          const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', userId);

          if (profileError) {
            request.log.error(
              { userId, error: profileError.message },
              'Manual profile deletion failed'
            );
            throw new ExternalServiceError(
              'Supabase',
              `Failed to delete account: ${profileError.message}`
            );
          }

          request.log.info({ userId }, 'Profile deleted via fallback method');
        }

        request.log.info({ userId }, 'Account deletion completed successfully');

        return {
          success: true,
          message: 'Account deleted successfully',
        };
      } catch (error) {
        if (error instanceof ExternalServiceError) {
          throw error;
        }

        request.log.error({ userId, error }, 'Unexpected account deletion error');
        throw new ExternalServiceError('Account Deletion', 'Failed to delete account', {
          originalError: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  fastify.log.info('Consolidated authentication routes registered');
}
