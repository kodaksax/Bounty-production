/**
 * Consolidated Bounty Routes
 * Unified bounty management endpoints consolidating logic from api/server.js
 * 
 * Phase 2.3 of backend consolidation project
 * 
 * Migrated from:
 * - api/server.js (lines 423-933)
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/unified-auth';
import { 
  asyncHandler, 
  ValidationError, 
  NotFoundError, 
  AuthorizationError,
  ConflictError
} from '../middleware/error-handler';
import { config } from '../config';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

/**
 * Validation schemas using Zod
 */

// Schema for creating a new bounty
const createBountySchema = z.object({
  title: z.string()
    .min(10, 'Title must be at least 10 characters')
    .max(200, 'Title must be at most 200 characters'),
  description: z.string()
    .min(50, 'Description must be at least 50 characters')
    .max(5000, 'Description must be at most 5000 characters'),
  amount: z.number()
    .min(0, 'Amount must be non-negative'),
  isForHonor: z.boolean()
    .optional()
    .default(false),
  location: z.string()
    .optional(),
  category: z.string()
    .optional(),
  skills_required: z.array(z.string())
    .optional(),
  due_date: z.string()
    .datetime()
    .optional(),
}).refine(data => {
  if (data.isForHonor && data.amount > 0) {
    return false;
  }
  return true;
}, { 
  message: 'Honor bounties must have amount set to 0',
  path: ['amount']
});

// Schema for updating a bounty (partial)
const updateBountySchema = createBountySchema.partial();

// Schema for listing bounties with filters
const listBountiesSchema = z.object({
  status: z.enum(['open', 'in_progress', 'completed', 'archived'])
    .optional(),
  category: z.string()
    .optional(),
  user_id: z.string()
    .uuid('Invalid user ID format')
    .optional(),
  accepted_by: z.string()
    .uuid('Invalid user ID format')
    .optional(),
  page: z.number()
    .int()
    .min(1)
    .optional()
    .default(1),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20),
  sortBy: z.enum(['created_at', 'amount', 'due_date'])
    .optional()
    .default('created_at'),
  sortOrder: z.enum(['asc', 'desc'])
    .optional()
    .default('desc'),
});

/**
 * Bounty interface matching Supabase schema
 */
interface Bounty {
  id: string;
  user_id: string;
  title: string;
  description: string;
  amount: number;
  isForHonor?: boolean;
  location?: string;
  category?: string;
  skills_required?: string[];
  status: 'open' | 'in_progress' | 'completed' | 'archived';
  accepted_by?: string | null;
  created_at: string;
  updated_at: string;
  due_date?: string | null;
}

/**
 * Supabase admin client singleton
 */
let supabaseAdmin: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
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
 * Helper function to check bounty ownership
 */
function checkOwnership(bounty: Bounty, userId: string): boolean {
  return bounty.user_id === userId;
}

/**
 * Helper function to validate status transitions
 */
function validateStatusTransition(
  currentStatus: string,
  action: 'accept' | 'complete' | 'archive'
): { valid: boolean; error?: string } {
  const validTransitions: Record<string, string[]> = {
    'open': ['accept', 'archive'],
    'in_progress': ['complete', 'archive'],
    'completed': [],
    'archived': []
  };

  const allowedActions = validTransitions[currentStatus] || [];
  
  if (!allowedActions.includes(action)) {
    return {
      valid: false,
      error: `Cannot ${action} bounty with status: ${currentStatus}`
    };
  }

  return { valid: true };
}

/**
 * Register all consolidated bounty routes
 */
export async function registerConsolidatedBountyRoutes(
  fastify: FastifyInstance
): Promise<void> {
  
  /**
   * GET /api/bounties
   * List bounties with optional filters and pagination
   * 
   * - Optional authentication (shows personalized results if authenticated)
   * - Supports filtering by status, category, user_id, accepted_by
   * - Supports pagination with page/limit
   * - Supports sorting by created_at, amount, due_date
   * 
   * @query {string} status - Filter by bounty status
   * @query {string} category - Filter by category
   * @query {string} user_id - Filter by poster user ID
   * @query {string} accepted_by - Filter by hunter user ID
   * @query {number} page - Page number (default: 1)
   * @query {number} limit - Results per page (default: 20, max: 100)
   * @query {string} sortBy - Sort field (default: created_at)
   * @query {string} sortOrder - Sort order (default: desc)
   * 
   * @returns {200} Array of bounties matching filters
   * @returns {400} Invalid query parameters
   */
  fastify.get(
    '/api/bounties',
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'List bounties with filters and pagination',
        querystring: listBountiesSchema,
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const query = listBountiesSchema.parse(request.query);

      request.log.info(
        { 
          filters: query, 
          authenticated: !!request.userId 
        },
        'Listing bounties'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Build query
        let dbQuery = supabase
          .from('bounties')
          .select('*', { count: 'exact' });

        // Apply filters
        if (query.status) {
          dbQuery = dbQuery.eq('status', query.status);
        } else {
          // Default to showing only open bounties if no status specified
          dbQuery = dbQuery.eq('status', 'open');
        }

        if (query.category) {
          dbQuery = dbQuery.eq('category', query.category);
        }

        if (query.user_id) {
          dbQuery = dbQuery.eq('user_id', query.user_id);
        }

        if (query.accepted_by) {
          dbQuery = dbQuery.eq('accepted_by', query.accepted_by);
        }

        // Apply sorting
        dbQuery = dbQuery.order(query.sortBy, { ascending: query.sortOrder === 'asc' });

        // Apply pagination
        const from = (query.page - 1) * query.limit;
        const to = from + query.limit - 1;
        dbQuery = dbQuery.range(from, to);

        const { data: bounties, error, count } = await dbQuery;

        if (error) {
          request.log.error({ error: error.message }, 'Failed to list bounties');
          throw new Error(error.message);
        }

        request.log.info(
          { count: bounties?.length || 0, total: count },
          'Bounties listed successfully'
        );

        return {
          bounties: bounties || [],
          pagination: {
            page: query.page,
            limit: query.limit,
            total: count || 0,
            totalPages: count ? Math.ceil(count / query.limit) : 0,
          },
        };
      } catch (error) {
        request.log.error({ error }, 'Unexpected error listing bounties');
        throw error;
      }
    })
  );

  /**
   * GET /api/bounties/:id
   * Get bounty details by ID
   * 
   * - Optional authentication (shows more details if owner)
   * - Returns 404 if bounty not found
   * 
   * @param {string} id - Bounty UUID
   * @returns {200} Bounty details
   * @returns {404} Bounty not found
   */
  fastify.get(
    '/api/bounties/:id',
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'Get bounty details by ID',
        params: z.object({
          id: z.string().uuid('Invalid bounty ID format'),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      request.log.info(
        { bountyId: id, requesterId: request.userId },
        'Fetching bounty by ID'
      );

      try {
        const supabase = getSupabaseAdmin();

        const { data: bounty, error } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundError('Bounty', id);
          }
          request.log.error({ error: error.message, bountyId: id }, 'Bounty fetch failed');
          throw new Error(error.message);
        }

        if (!bounty) {
          throw new NotFoundError('Bounty', id);
        }

        request.log.info(
          { bountyId: id },
          'Bounty fetched successfully'
        );

        return bounty;
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw error;
        }
        request.log.error({ error, bountyId: id }, 'Unexpected error fetching bounty');
        throw error;
      }
    })
  );

  /**
   * POST /api/bounties
   * Create a new bounty
   * 
   * - Requires authentication
   * - Validates title, description, amount
   * - Enforces honor bounty rules (isForHonor=true requires amount=0)
   * - Sets initial status to 'open'
   * - Sets user_id to authenticated user
   * 
   * @header {string} Authorization - Bearer token (required)
   * @body {string} title - Bounty title (10-200 chars, required)
   * @body {string} description - Bounty description (50-5000 chars, required)
   * @body {number} amount - Bounty amount in USD (required, min 0)
   * @body {boolean} isForHonor - Whether this is an honor bounty (optional, default: false)
   * @body {string} location - Location/address (optional)
   * @body {string} category - Bounty category (optional)
   * @body {string[]} skills_required - Required skills (optional)
   * @body {string} due_date - Due date in ISO 8601 format (optional)
   * 
   * @returns {201} Bounty created successfully
   * @returns {400} Validation error
   * @returns {401} Authentication required
   */
  fastify.post(
    '/api/bounties',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'Create a new bounty',
        body: createBountySchema,
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              user_id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              amount: { type: 'number' },
              status: { type: 'string' },
              created_at: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = createBountySchema.parse(request.body);

      request.log.info(
        { userId, title: body.title, amount: body.amount, isForHonor: body.isForHonor },
        'Creating bounty'
      );

      // Additional business logic validation
      if (!body.isForHonor && body.amount === 0) {
        throw new ValidationError(
          'Non-honor bounties must have an amount greater than 0',
          { field: 'amount' }
        );
      }

      try {
        const supabase = getSupabaseAdmin();

        // Prepare bounty data
        const bountyData: any = {
          user_id: userId,
          title: body.title,
          description: body.description,
          amount: body.amount,
          isForHonor: body.isForHonor,
          status: 'open',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Add optional fields
        if (body.location) bountyData.location = body.location;
        if (body.category) bountyData.category = body.category;
        if (body.skills_required) bountyData.skills_required = body.skills_required;
        if (body.due_date) bountyData.due_date = body.due_date;

        const { data: bounty, error } = await supabase
          .from('bounties')
          .insert(bountyData)
          .select()
          .single();

        if (error) {
          request.log.error(
            { error: error.message, userId },
            'Bounty creation failed'
          );
          throw new Error(error.message);
        }

        request.log.info(
          { userId, bountyId: bounty.id },
          'Bounty created successfully'
        );

        reply.code(201);
        return bounty;
      } catch (error) {
        request.log.error(
          { error, userId },
          'Unexpected error creating bounty'
        );
        throw error;
      }
    })
  );

  /**
   * PATCH /api/bounties/:id
   * Update bounty fields
   * 
   * - Requires authentication
   * - Only bounty owner can update
   * - Cannot update if status is 'completed' or 'archived'
   * - Cannot change user_id or created_at
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Bounty UUID
   * @body Partial bounty fields to update
   * 
   * @returns {200} Bounty updated successfully
   * @returns {400} Validation error
   * @returns {401} Authentication required
   * @returns {403} Not the bounty owner
   * @returns {404} Bounty not found
   * @returns {409} Cannot update completed or archived bounty
   */
  fastify.patch(
    '/api/bounties/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'Update bounty fields (owner only)',
        params: z.object({
          id: z.string().uuid('Invalid bounty ID format'),
        }),
        body: updateBountySchema,
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id: bountyId } = request.params as { id: string };
      const userId = request.userId!;
      const body = updateBountySchema.parse(request.body);

      request.log.info(
        { userId, bountyId, fields: Object.keys(body) },
        'Updating bounty'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Fetch existing bounty
        const { data: bounty, error: fetchError } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', bountyId)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            throw new NotFoundError('Bounty', bountyId);
          }
          throw new Error(fetchError.message);
        }

        if (!bounty) {
          throw new NotFoundError('Bounty', bountyId);
        }

        // Check ownership
        if (!checkOwnership(bounty, userId)) {
          request.log.warn(
            { userId, bountyId, ownerId: bounty.user_id },
            'Attempted to update another user bounty'
          );
          throw new AuthorizationError('Only the bounty owner can perform this action');
        }

        // Check if bounty can be updated
        if (bounty.status === 'completed' || bounty.status === 'archived') {
          throw new ConflictError(
            `Cannot update bounty with status: ${bounty.status}`
          );
        }

        // Prepare update data
        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        // Copy allowed fields
        if (body.title !== undefined) updateData.title = body.title;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.amount !== undefined) updateData.amount = body.amount;
        if (body.isForHonor !== undefined) updateData.isForHonor = body.isForHonor;
        if (body.location !== undefined) updateData.location = body.location;
        if (body.category !== undefined) updateData.category = body.category;
        if (body.skills_required !== undefined) updateData.skills_required = body.skills_required;
        if (body.due_date !== undefined) updateData.due_date = body.due_date;

        // Validate honor bounty rules if being updated
        if (updateData.isForHonor !== undefined || updateData.amount !== undefined) {
          const finalIsForHonor = updateData.isForHonor ?? bounty.isForHonor;
          const finalAmount = updateData.amount ?? bounty.amount;
          
          if (finalIsForHonor && finalAmount > 0) {
            throw new ValidationError(
              'Honor bounties must have amount set to 0',
              { field: 'amount' }
            );
          }
        }

        // Update bounty
        const { data: updatedBounty, error: updateError } = await supabase
          .from('bounties')
          .update(updateData)
          .eq('id', bountyId)
          .select()
          .single();

        if (updateError) {
          request.log.error(
            { error: updateError.message, bountyId },
            'Bounty update failed'
          );
          throw new Error(updateError.message);
        }

        request.log.info(
          { userId, bountyId },
          'Bounty updated successfully'
        );

        return updatedBounty;
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof AuthorizationError || 
            error instanceof ConflictError ||
            error instanceof ValidationError) {
          throw error;
        }
        request.log.error(
          { error, bountyId },
          'Unexpected error updating bounty'
        );
        throw error;
      }
    })
  );

  /**
   * DELETE /api/bounties/:id
   * Delete bounty
   * 
   * - Requires authentication
   * - Only bounty owner can delete
   * - Permanently removes bounty from database
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Bounty UUID
   * 
   * @returns {200} Bounty deleted successfully
   * @returns {401} Authentication required
   * @returns {403} Not the bounty owner
   * @returns {404} Bounty not found
   */
  fastify.delete(
    '/api/bounties/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'Delete bounty (owner only)',
        params: z.object({
          id: z.string().uuid('Invalid bounty ID format'),
        }),
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
      const { id: bountyId } = request.params as { id: string };
      const userId = request.userId!;

      request.log.info(
        { userId, bountyId },
        'Deleting bounty'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Fetch existing bounty to check ownership
        const { data: bounty, error: fetchError } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', bountyId)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            throw new NotFoundError('Bounty', bountyId);
          }
          throw new Error(fetchError.message);
        }

        if (!bounty) {
          throw new NotFoundError('Bounty', bountyId);
        }

        // Check ownership
        if (!checkOwnership(bounty, userId)) {
          request.log.warn(
            { userId, bountyId, ownerId: bounty.user_id },
            'Attempted to delete another user bounty'
          );
          throw new AuthorizationError('Only the bounty owner can perform this action');
        }

        // Delete bounty
        const { error: deleteError } = await supabase
          .from('bounties')
          .delete()
          .eq('id', bountyId);

        if (deleteError) {
          request.log.error(
            { error: deleteError.message, bountyId },
            'Bounty deletion failed'
          );
          throw new Error(deleteError.message);
        }

        request.log.info(
          { userId, bountyId },
          'Bounty deleted successfully'
        );

        return {
          success: true,
          message: 'Bounty deleted successfully',
        };
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof AuthorizationError) {
          throw error;
        }
        request.log.error(
          { error, bountyId },
          'Unexpected error deleting bounty'
        );
        throw error;
      }
    })
  );

  /**
   * POST /api/bounties/:id/accept
   * Accept a bounty (hunter applies)
   * 
   * - Requires authentication
   * - Bounty must have 'open' status
   * - Cannot accept own bounty
   * - Sets status to 'in_progress' and accepted_by to current user
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Bounty UUID
   * 
   * @returns {200} Bounty accepted successfully
   * @returns {400} Invalid status for acceptance
   * @returns {401} Authentication required
   * @returns {404} Bounty not found
   * @returns {409} Already accepted or trying to accept own bounty
   */
  fastify.post(
    '/api/bounties/:id/accept',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'Accept a bounty',
        params: z.object({
          id: z.string().uuid('Invalid bounty ID format'),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id: bountyId } = request.params as { id: string };
      const userId = request.userId!;

      request.log.info(
        { userId, bountyId },
        'Accepting bounty'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Fetch existing bounty
        const { data: bounty, error: fetchError } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', bountyId)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            throw new NotFoundError('Bounty', bountyId);
          }
          throw new Error(fetchError.message);
        }

        if (!bounty) {
          throw new NotFoundError('Bounty', bountyId);
        }

        // Check if user is trying to accept own bounty
        if (bounty.user_id === userId) {
          throw new ValidationError('You cannot accept your own bounty');
        }

        // Validate status transition
        const transition = validateStatusTransition(bounty.status, 'accept');
        if (!transition.valid) {
          throw new ConflictError(transition.error!);
        }

        // Check if already accepted
        if (bounty.status === 'in_progress' || bounty.accepted_by) {
          throw new ConflictError('This bounty has already been accepted');
        }

        // Update bounty
        const { data: updatedBounty, error: updateError } = await supabase
          .from('bounties')
          .update({
            status: 'in_progress',
            accepted_by: userId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', bountyId)
          .select()
          .single();

        if (updateError) {
          request.log.error(
            { error: updateError.message, bountyId },
            'Bounty acceptance failed'
          );
          throw new Error(updateError.message);
        }

        request.log.info(
          { userId, bountyId },
          'Bounty accepted successfully'
        );

        return updatedBounty;
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof ValidationError || 
            error instanceof ConflictError) {
          throw error;
        }
        request.log.error(
          { error, bountyId },
          'Unexpected error accepting bounty'
        );
        throw error;
      }
    })
  );

  /**
   * POST /api/bounties/:id/complete
   * Mark bounty as complete (hunter submits completion)
   * 
   * - Requires authentication
   * - Bounty must have 'in_progress' status
   * - Only the hunter (accepted_by user) can mark complete
   * - Sets status to 'completed'
   * - Future: Triggers wallet escrow release
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Bounty UUID
   * 
   * @returns {200} Bounty marked complete successfully
   * @returns {400} Invalid status for completion
   * @returns {401} Authentication required
   * @returns {403} Not the assigned hunter
   * @returns {404} Bounty not found
   * @returns {409} Invalid status transition
   */
  fastify.post(
    '/api/bounties/:id/complete',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'Mark bounty complete (hunter only)',
        params: z.object({
          id: z.string().uuid('Invalid bounty ID format'),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id: bountyId } = request.params as { id: string };
      const userId = request.userId!;

      request.log.info(
        { userId, bountyId },
        'Marking bounty complete'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Fetch existing bounty
        const { data: bounty, error: fetchError } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', bountyId)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            throw new NotFoundError('Bounty', bountyId);
          }
          throw new Error(fetchError.message);
        }

        if (!bounty) {
          throw new NotFoundError('Bounty', bountyId);
        }

        // Validate status transition
        const transition = validateStatusTransition(bounty.status, 'complete');
        if (!transition.valid) {
          throw new ConflictError(transition.error!);
        }

        // Check if user is the assigned hunter
        if (bounty.accepted_by !== userId) {
          request.log.warn(
            { userId, bountyId, hunterId: bounty.accepted_by },
            'Attempted to complete bounty not assigned to user'
          );
          throw new AuthorizationError('Only the assigned hunter can mark this bounty complete');
        }

        // Update bounty
        const { data: updatedBounty, error: updateError } = await supabase
          .from('bounties')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bountyId)
          .select()
          .single();

        if (updateError) {
          request.log.error(
            { error: updateError.message, bountyId },
            'Bounty completion failed'
          );
          throw new Error(updateError.message);
        }

        request.log.info(
          { userId, bountyId },
          'Bounty marked complete successfully'
        );

        // TODO: Phase 3 - Trigger wallet escrow release

        return updatedBounty;
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof AuthorizationError || 
            error instanceof ConflictError) {
          throw error;
        }
        request.log.error(
          { error, bountyId },
          'Unexpected error completing bounty'
        );
        throw error;
      }
    })
  );

  /**
   * POST /api/bounties/:id/archive
   * Archive a bounty
   * 
   * - Requires authentication
   * - Only bounty owner can archive
   * - Can archive any status except 'completed'
   * - Sets status to 'archived'
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Bounty UUID
   * 
   * @returns {200} Bounty archived successfully
   * @returns {401} Authentication required
   * @returns {403} Not the bounty owner
   * @returns {404} Bounty not found
   * @returns {409} Cannot archive completed bounty
   */
  fastify.post(
    '/api/bounties/:id/archive',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounties'],
        description: 'Archive bounty (owner only)',
        params: z.object({
          id: z.string().uuid('Invalid bounty ID format'),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id: bountyId } = request.params as { id: string };
      const userId = request.userId!;

      request.log.info(
        { userId, bountyId },
        'Archiving bounty'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Fetch existing bounty
        const { data: bounty, error: fetchError } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', bountyId)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            throw new NotFoundError('Bounty', bountyId);
          }
          throw new Error(fetchError.message);
        }

        if (!bounty) {
          throw new NotFoundError('Bounty', bountyId);
        }

        // Check ownership
        if (!checkOwnership(bounty, userId)) {
          request.log.warn(
            { userId, bountyId, ownerId: bounty.user_id },
            'Attempted to archive another user bounty'
          );
          throw new AuthorizationError('Only the bounty owner can perform this action');
        }

        // Validate status transition
        const transition = validateStatusTransition(bounty.status, 'archive');
        if (!transition.valid) {
          throw new ConflictError(transition.error!);
        }

        // Update bounty
        const { data: updatedBounty, error: updateError } = await supabase
          .from('bounties')
          .update({
            status: 'archived',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bountyId)
          .select()
          .single();

        if (updateError) {
          request.log.error(
            { error: updateError.message, bountyId },
            'Bounty archival failed'
          );
          throw new Error(updateError.message);
        }

        request.log.info(
          { userId, bountyId },
          'Bounty archived successfully'
        );

        return updatedBounty;
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof AuthorizationError || 
            error instanceof ConflictError) {
          throw error;
        }
        request.log.error(
          { error, bountyId },
          'Unexpected error archiving bounty'
        );
        throw error;
      }
    })
  );

  fastify.log.info('Consolidated bounty routes registered');
}
