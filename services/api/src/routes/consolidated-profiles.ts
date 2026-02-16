/**
 * Consolidated Profile Routes
 * Unified profile management endpoints consolidating logic from api/server.js
 * 
 * Phase 2.2 of backend consolidation project
 * 
 * Migrated from:
 * - api/server.js (lines 348-418)
 */

import { createClient } from '@supabase/supabase-js';
import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import {
  asyncHandler,
  AuthorizationError,
  NotFoundError,
  ValidationError
} from '../middleware/error-handler';
import { AuthenticatedRequest, authMiddleware, optionalAuthMiddleware } from '../middleware/unified-auth';
import redisService, { cacheInvalidation, CacheKeyPrefix } from '../services/redis-service';
import { toJsonSchema } from '../utils/zod-json';

/**
 * Validation schemas using Zod
 */

// Schema for updating profile fields
const updateProfileSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username must contain only letters, numbers, and underscores')
    .optional(),
  avatar_url: z.string()
    .url('Invalid URL format')
    .optional()
    .nullable(),
  bio: z.string()
    .max(500, 'Bio must be at most 500 characters')
    .optional()
    .nullable(),
  about: z.string()
    .max(500, 'About must be at most 500 characters')
    .optional()
    .nullable(),
  phone: z.string()
    .optional()
    .nullable(),
});

// Schema for PATCH operations (partial updates) - same as update since all fields are already optional
const patchProfileSchema = updateProfileSchema;

// Schema for POST operations (create/update full profile)
const createProfileSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username must contain only letters, numbers, and underscores'),
  avatar_url: z.string()
    .url('Invalid URL format')
    .optional()
    .nullable(),
  bio: z.string()
    .max(500, 'Bio must be at most 500 characters')
    .optional()
    .nullable(),
  about: z.string()
    .max(500, 'About must be at most 500 characters')
    .optional()
    .nullable(),
  phone: z.string()
    .optional()
    .nullable(),
  email: z.string()
    .email('Invalid email format')
    .optional(),
});

/**
 * Profile interface matching Supabase schema
 */
interface Profile {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  avatar_url?: string;
  about?: string;
  bio?: string;
  phone?: string;
  balance: number;
  withdrawal_count?: number;
  cancellation_count?: number;
  age_verified?: boolean;
  age_verified_at?: string;
  onboarding_completed?: boolean;
  created_at: string;
  updated_at: string;
  // Sensitive fields (never exposed)
  stripe_customer_id?: string;
  stripe_connect_account_id?: string;
}

/**
 * Supabase admin client singleton
 */
let supabaseAdmin: ReturnType<typeof createClient<any>> | null = null;

function getSupabaseAdmin(): ReturnType<typeof createClient<any>> {
  if (!supabaseAdmin) {
    // Relax typing to avoid PostgREST `never` inference on partial updates
    supabaseAdmin = createClient<any>(
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
 * Sanitize profile data to remove sensitive fields
 * @param profile - Raw profile data from database
 * @param isOwner - Whether the requesting user is the profile owner
 * @returns Sanitized profile object safe to send to client
 */
function sanitizeProfile(profile: any, isOwner: boolean = false): any {
  if (!profile) return null;

  // Normalize avatar field names (handle both 'avatar' and 'avatar_url')
  const avatar = profile.avatar_url || profile.avatar;

  // Base fields visible to everyone
  const sanitized: any = {
    id: profile.id,
    username: profile.username,
    avatar_url: avatar,
    bio: profile.bio || profile.about || null,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    age_verified: profile.age_verified || false,
  };

  // Additional fields visible only to the profile owner
  if (isOwner) {
    sanitized.email = profile.email;
    sanitized.balance = profile.balance || 0;
    sanitized.phone = profile.phone;
    sanitized.withdrawal_count = profile.withdrawal_count || 0;
    sanitized.cancellation_count = profile.cancellation_count || 0;
    sanitized.age_verified_at = profile.age_verified_at;
    sanitized.onboarding_completed = profile.onboarding_completed || false;
  }

  // Never expose these fields
  // stripe_customer_id, stripe_connect_account_id are filtered out

  return sanitized;
}

/**
 * Register all consolidated profile routes
 */
export async function registerConsolidatedProfileRoutes(
  fastify: FastifyInstance
): Promise<void> {
  
  /**
   * GET /api/profiles/:id
   * Get public profile by ID
   * 
   * - No authentication required (public endpoint)
   * - Uses optionalAuthMiddleware to show more details if authenticated and owner
   * - Returns sanitized profile data
   * 
   * @param {string} id - Profile UUID
   * @returns {200} Profile data (sanitized based on ownership)
   * @returns {404} Profile not found
   */
  fastify.get(
    '/api/profiles/:id',
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        tags: ['profiles'],
        description: 'Get public profile by ID',
        // Provide Fastify with JSON Schema converted from Zod for params validation
        params: toJsonSchema(z.object({ id: z.string().uuid('Invalid profile ID format') }), 'GetProfileParams'),
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              avatar_url: { type: ['string', 'null'] },
              bio: { type: ['string', 'null'] },
              created_at: { type: 'string' },
              updated_at: { type: 'string' },
              age_verified: { type: 'boolean' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      request.log.info(
        { profileId: id, requesterId: request.userId },
        'Fetching profile by ID'
      );

      try {
        // Try to get from cache first
        // Note: We cache the full profile data from the database, then apply
        // sanitization based on the requester's ownership when serving.
        // This means the same cached profile can show different fields
        // depending on who requests it (owner sees sensitive fields, others don't).
        const cachedProfile = await redisService.get<any>(id, CacheKeyPrefix.PROFILE);
        
        if (cachedProfile) {
          request.log.info({ profileId: id }, 'Profile fetched from cache');
          
          // Check if requester is the profile owner
          const isOwner = request.userId === id;
          const sanitized = sanitizeProfile(cachedProfile, isOwner);
          
          return sanitized;
        }

        // Cache miss - fetch from database
        const supabase = getSupabaseAdmin();

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundError('Profile', id);
          }
          request.log.error({ error: error.message, profileId: id }, 'Profile fetch failed');
          throw new Error(error.message);
        }

        if (!profile) {
          throw new NotFoundError('Profile', id);
        }

        // Store in cache for future requests
        await redisService.set(id, profile, CacheKeyPrefix.PROFILE);

        // Check if requester is the profile owner
        const isOwner = request.userId === id;

        const sanitized = sanitizeProfile(profile, isOwner);

        request.log.info(
          { profileId: id, isOwner, cached: false },
          'Profile fetched successfully'
        );

        return sanitized;
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw error;
        }
        request.log.error({ error, profileId: id }, 'Unexpected error fetching profile');
        throw error;
      }
    })
  );

  /**
   * GET /api/profile
   * Get current authenticated user's profile
   * 
   * - Requires authentication
   * - Returns full profile data including sensitive owner-only fields
   * 
   * @header {string} Authorization - Bearer token (required)
   * @returns {200} Full profile data for authenticated user
   * @returns {401} Authentication required
   * @returns {404} Profile not found
   */
  fastify.get(
    '/api/profile',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['profiles'],
        description: 'Get current authenticated user profile',
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              email: { type: ['string', 'null'] },
              avatar_url: { type: ['string', 'null'] },
              bio: { type: ['string', 'null'] },
              phone: { type: ['string', 'null'] },
              balance: { type: 'number' },
              created_at: { type: 'string' },
              updated_at: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      request.log.info(
        { userId },
        'Fetching current user profile'
      );

      try {
        // Try to get from cache first
        const cachedProfile = await redisService.get<any>(userId, CacheKeyPrefix.PROFILE);
        
        if (cachedProfile) {
          request.log.info({ userId }, 'Current user profile fetched from cache');
          const sanitized = sanitizeProfile(cachedProfile, true);
          return sanitized;
        }

        // Cache miss - fetch from database
        const supabase = getSupabaseAdmin();

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundError('Profile', userId);
          }
          request.log.error({ error: error.message, userId }, 'Profile fetch failed');
          throw new Error(error.message);
        }

        if (!profile) {
          throw new NotFoundError('Profile', userId);
        }

        // Store in cache for future requests
        await redisService.set(userId, profile, CacheKeyPrefix.PROFILE);

        // Return full profile for owner
        const sanitized = sanitizeProfile(profile, true);

        request.log.info(
          { userId, cached: false },
          'Current user profile fetched successfully'
        );

        return sanitized;
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw error;
        }
        request.log.error({ error, userId }, 'Unexpected error fetching current user profile');
        throw error;
      }
    })
  );

  /**
   * POST /api/profiles
   * Create or update profile
   * 
   * - Requires authentication
   * - Creates new profile or updates existing one for current user
   * - Validates input data with Zod
   * 
   * @header {string} Authorization - Bearer token (required)
   * @body {string} username - Username (required)
   * @body {string} avatar_url - Avatar URL (optional)
   * @body {string} bio - User bio (optional)
   * @body {string} phone - Phone number (optional)
   * 
   * @returns {200} Profile created/updated successfully
   * @returns {400} Validation error
   * @returns {401} Authentication required
   * @returns {409} Username already taken
   */
  fastify.post(
    '/api/profiles',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['profiles'],
        description: 'Create or update profile for authenticated user',
        // Provide Fastify with JSON Schema converted from Zod for body validation
        body: toJsonSchema(createProfileSchema, 'CreateProfileBody'),
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              email: { type: ['string', 'null'] },
              avatar_url: { type: ['string', 'null'] },
              bio: { type: ['string', 'null'] },
              created_at: { type: 'string' },
              updated_at: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = createProfileSchema.parse(request.body);

      request.log.info(
        { userId, username: body.username },
        'Creating/updating profile'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Check if username is already taken by another user
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, username')
          .eq('username', body.username)
          .maybeSingle();

        if (existingProfile && existingProfile.id !== userId) {
          throw new ValidationError('Username already taken', {
            field: 'username',
            value: body.username,
          });
        }

        // Prepare update data - don't set `updated_at` here; DB trigger manages timestamps
        const updateData: any = {};

        if (body.username !== undefined) updateData.username = body.username;
        if (body.avatar_url !== undefined) updateData.avatar = body.avatar_url;
        if (body.bio !== undefined) updateData.bio = body.bio;
        if (body.about !== undefined) updateData.about = body.about;
        if (body.phone !== undefined) updateData.phone = body.phone;
        if (body.email !== undefined) updateData.email = body.email;

        // Use upsert to create or update; leave timestamp management to DB triggers
        const { data: profile, error } = await supabase
          .from('profiles')
          .upsert(
            {
              id: userId,
              ...updateData,
            },
            {
              onConflict: 'id',
            }
          )
          .select()
          .single();

        if (error) {
          request.log.error(
            { error: error.message, userId },
            'Profile upsert failed'
          );
          
          // Handle unique constraint violations
          if (error.code === '23505') {
            throw new ValidationError('Username already taken', {
              field: 'username',
            });
          }
          
          throw new Error(error.message);
        }

        // Invalidate cache for this profile
        await cacheInvalidation.invalidateProfile(userId);

        const sanitized = sanitizeProfile(profile, true);

        request.log.info(
          { userId, username: body.username },
          'Profile created/updated successfully'
        );

        return sanitized;
      } catch (error) {
        if (error instanceof ValidationError) {
          throw error;
        }
        request.log.error(
          { error, userId },
          'Unexpected error creating/updating profile'
        );
        throw error;
      }
    })
  );

  /**
   * PATCH /api/profiles/:id
   * Update specific profile fields
   * 
   * - Requires authentication
   * - Validates ownership (user can only update their own profile)
   * - Allows partial updates
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Profile UUID (must match authenticated user)
   * @body {string} username - Username (optional)
   * @body {string} avatar_url - Avatar URL (optional)
   * @body {string} bio - User bio (optional)
   * 
   * @returns {200} Profile updated successfully
   * @returns {400} Validation error
   * @returns {401} Authentication required
   * @returns {403} Cannot modify another user's profile
   * @returns {404} Profile not found
   */
  fastify.patch(
    '/api/profiles/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['profiles'],
        description: 'Update specific profile fields (owner only)',
        // Params validated in handler via runtime checks; use generic JSON schema for Fastify
        params: { type: 'object' },
        // Validation performed in handler; provide generic JSON schema for Fastify
        body: { type: 'object' },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              email: { type: ['string', 'null'] },
              avatar_url: { type: ['string', 'null'] },
              bio: { type: ['string', 'null'] },
              updated_at: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id: profileId } = request.params as { id: string };
      const userId = request.userId!;
      const body = patchProfileSchema.parse(request.body);

      request.log.info(
        { userId, profileId, fields: Object.keys(body) },
        'Patching profile'
      );

      // Check ownership
      if (userId !== profileId) {
        request.log.warn(
          { userId, profileId },
          'Attempted to modify another user profile'
        );
        throw new AuthorizationError('You can only modify your own profile');
      }

      try {
        const supabase = getSupabaseAdmin();

        // Check if username is already taken by another user
        if (body.username) {
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('username', body.username)
            .maybeSingle();

          if (existingProfile && existingProfile.id !== userId) {
            throw new ValidationError('Username already taken', {
              field: 'username',
              value: body.username,
            });
          }
        }

        // Prepare update data - let DB triggers manage `updated_at`
        const updateData: any = {};

        if (body.username !== undefined) updateData.username = body.username;
        if (body.avatar_url !== undefined) updateData.avatar = body.avatar_url;
        if (body.bio !== undefined) updateData.bio = body.bio;
        if (body.about !== undefined) updateData.about = body.about;
        if (body.phone !== undefined) updateData.phone = body.phone;

        // Update profile
        const { data: profile, error } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', profileId)
          .select()
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundError('Profile', profileId);
          }
          
          // Handle unique constraint violations
          if (error.code === '23505') {
            throw new ValidationError('Username already taken', {
              field: 'username',
            });
          }
          
          request.log.error(
            { error: error.message, profileId },
            'Profile update failed'
          );
          throw new Error(error.message);
        }

        if (!profile) {
          throw new NotFoundError('Profile', profileId);
        }

        // Invalidate cache for this profile
        await cacheInvalidation.invalidateProfile(profileId);

        const sanitized = sanitizeProfile(profile, true);

        request.log.info(
          { userId, profileId },
          'Profile updated successfully'
        );

        return sanitized;
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof AuthorizationError || 
            error instanceof ValidationError) {
          throw error;
        }
        request.log.error(
          { error, profileId },
          'Unexpected error updating profile'
        );
        throw error;
      }
    })
  );

  /**
   * DELETE /api/profiles/:id
   * Delete profile
   * 
   * - Requires authentication
   * - Validates ownership (user can only delete their own profile)
   * - Note: This deletes the profile record but not the auth.users entry
   *   For full account deletion, use DELETE /auth/delete-account
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Profile UUID (must match authenticated user)
   * 
   * @returns {200} Profile deleted successfully
   * @returns {401} Authentication required
   * @returns {403} Cannot delete another user's profile
   * @returns {404} Profile not found
   */
  fastify.delete(
    '/api/profiles/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['profiles'],
        description: 'Delete profile (owner only)',
        // Params validated in handler via runtime checks; use generic JSON schema for Fastify
        params: { type: 'object' },
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
      const { id: profileId } = request.params as { id: string };
      const userId = request.userId!;

      request.log.info(
        { userId, profileId },
        'Deleting profile'
      );

      // Check ownership
      if (userId !== profileId) {
        request.log.warn(
          { userId, profileId },
          'Attempted to delete another user profile'
        );
        throw new AuthorizationError('You can only delete your own profile');
      }

      try {
        const supabase = getSupabaseAdmin();

        // Delete profile
        const { error } = await supabase
          .from('profiles')
          .delete()
          .eq('id', profileId);

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundError('Profile', profileId);
          }
          request.log.error(
            { error: error.message, profileId },
            'Profile deletion failed'
          );
          throw new Error(error.message);
        }

        request.log.info(
          { userId, profileId },
          'Profile deleted successfully'
        );

        return {
          success: true,
          message: 'Profile deleted successfully',
        };
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof AuthorizationError) {
          throw error;
        }
        request.log.error(
          { error, profileId },
          'Unexpected error deleting profile'
        );
        throw error;
      }
    })
  );

  fastify.log.info('Consolidated profile routes registered');
}
