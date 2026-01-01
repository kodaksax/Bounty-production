/**
 * Consolidated Bounty Request Routes
 * Unified bounty request/application management endpoints
 * 
 * Phase 2.4 of backend consolidation project
 * 
 * Migrated from:
 * - api/server.js (lines 939-1178)
 * 
 * Bounty requests = applications from hunters to accept bounties
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { authMiddleware, AuthenticatedRequest } from '../middleware/unified-auth';
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

// Schema for creating a new bounty request
const createRequestSchema = z.object({
  bounty_id: z.string().uuid('Invalid bounty ID format'),
  message: z.string()
    .min(50, 'Application message must be at least 50 characters')
    .max(1000, 'Application message must be at most 1000 characters'),
  proposed_completion_date: z.string()
    .datetime('Invalid date format')
    .optional(),
});

// Schema for updating a bounty request
const updateRequestSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'withdrawn'], {
    errorMap: () => ({ message: 'Status must be one of: accepted, rejected, withdrawn' })
  }),
});

// Schema for listing bounty requests with filters
const listRequestsSchema = z.object({
  bounty_id: z.string()
    .uuid('Invalid bounty ID format')
    .optional(),
  user_id: z.string()
    .uuid('Invalid user ID format')
    .optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'withdrawn'])
    .optional(),
  page: z.coerce.number()
    .int()
    .min(1)
    .optional()
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20),
});

/**
 * BountyRequest interface matching Supabase schema
 */
interface BountyRequest {
  id: string;
  bounty_id: string;
  hunter_id: string;  // user_id in old code
  poster_id?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  message?: string | null;
  proposed_completion_date?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Bounty interface for status checks
 */
interface Bounty {
  id: string;
  user_id: string;  // poster
  poster_id?: string;  // newer column name
  status: 'open' | 'in_progress' | 'completed' | 'archived';
  accepted_by?: string | null;
  [key: string]: any;
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
 * Helper to get the poster_id from a bounty (handles legacy user_id field)
 */
function getBountyPosterId(bounty: Bounty): string | null {
  // Prefer canonical poster_id; if missing, fall back to legacy user_id
  return bounty.poster_id || bounty.user_id || null;
}

/**
 * Register all consolidated bounty request routes
 */
export async function registerConsolidatedBountyRequestRoutes(
  fastify: FastifyInstance
): Promise<void> {
  
  /**
   * GET /api/bounty-requests
   * List bounty requests with optional filters
   * 
   * - Requires authentication
   * - Supports filtering by bounty_id, user_id, status
   * - Supports pagination with page/limit
   * - Returns requests with nested bounty and profile data
   * 
   * Authorization:
   * - Bounty owner sees all requests for their bounties
   * - Users see only their own applications
   * 
   * @query {string} bounty_id - Filter by bounty ID (optional)
   * @query {string} user_id - Filter by hunter user ID (optional)
   * @query {string} status - Filter by status (optional)
   * @query {number} page - Page number (default: 1)
   * @query {number} limit - Results per page (default: 20, max: 100)
   * 
   * @returns {200} Array of bounty requests matching filters
   * @returns {400} Invalid query parameters
   * @returns {401} Authentication required
   */
  fastify.get(
    '/api/bounty-requests',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounty-requests'],
        description: 'List bounty requests with filters and pagination',
        querystring: listRequestsSchema,
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const query = listRequestsSchema.parse(request.query);

      request.log.info(
        { 
          userId, 
          filters: query 
        },
        'Listing bounty requests'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Build query with joins to get bounty and profile data
        let dbQuery = supabase
          .from('bounty_requests')
          .select(`
            *,
            bounties:bounty_id (
              id,
              title,
              amount,
              location,
              work_type,
              deadline,
              is_for_honor
            ),
            profiles:hunter_id (
              id,
              username,
              avatar_url
            )
          `, { count: 'exact' });

        // Apply filters
        if (query.status) {
          dbQuery = dbQuery.eq('status', query.status);
        }

        if (query.bounty_id) {
          dbQuery = dbQuery.eq('bounty_id', query.bounty_id);
        }

        if (query.user_id) {
          // Filter by hunter_id (applicant)
          dbQuery = dbQuery.eq('hunter_id', query.user_id);
        }

        // Authorization filter: users can only see requests for their bounties or their own applications
        // We'll filter this in application code after fetching since complex OR conditions in Supabase can be tricky
        
        // Apply sorting
        dbQuery = dbQuery.order('created_at', { ascending: false });

        // Apply pagination
        const from = (query.page - 1) * query.limit;
        const to = from + query.limit - 1;
        dbQuery = dbQuery.range(from, to);

        const { data: requests, error, count } = await dbQuery;

        if (error) {
          request.log.error({ error: error.message }, 'Failed to list bounty requests');
          throw new Error(error.message);
        }

        // Authorization filter in application code
        // User can see requests if:
        // 1. They are the bounty poster (need to check bounty ownership)
        // 2. They are the hunter (applicant)
        
        // Fetch bounty ownership for authorization
        if (requests && requests.length > 0) {
          const bountyIds = [...new Set(requests.map(r => r.bounty_id))];
          const { data: bounties } = await supabase
            .from('bounties')
            .select('id, user_id, poster_id')
            .in('id', bountyIds);
          
          const bountyOwnership = new Map<string, string>();
          bounties?.forEach(b => {
            const posterId = b.poster_id || b.user_id;
            if (posterId) {
              bountyOwnership.set(b.id, posterId);
            }
          });

          // Filter requests based on authorization
          const authorizedRequests = requests.filter(req => {
            const isHunter = req.hunter_id === userId;
            const isPoster = bountyOwnership.get(req.bounty_id) === userId;
            return isHunter || isPoster;
          });

          request.log.info(
            { count: authorizedRequests.length, totalFromDb: count },
            'Bounty requests listed successfully'
          );

          // Note: Pagination metadata should reflect the original database count
          // when filtering happens in-memory. This provides accurate total counts
          // even though authorization filtering may reduce the returned items.
          // For large datasets, consider implementing database-level filtering with RLS.
          const total = typeof count === 'number' && Number.isFinite(count) ? count : authorizedRequests.length;
          
          return {
            requests: authorizedRequests,
            pagination: {
              page: query.page,
              limit: query.limit,
              total,
              totalPages: total > 0 ? Math.ceil(total / query.limit) : 0,
            },
          };
        }

        return {
          requests: [],
          pagination: {
            page: query.page,
            limit: query.limit,
            total: 0,
            totalPages: 0,
          },
        };
      } catch (error) {
        request.log.error({ error }, 'Unexpected error listing bounty requests');
        throw error;
      }
    })
  );

  /**
   * GET /api/bounty-requests/:id
   * Get bounty request details by ID
   * 
   * - Requires authentication
   * - Returns 404 if request not found
   * - Authorization: Only bounty owner or applicant can view
   * 
   * @param {string} id - Bounty request UUID
   * @returns {200} Bounty request details
   * @returns {401} Authentication required
   * @returns {403} Not authorized to view this request
   * @returns {404} Bounty request not found
   */
  fastify.get(
    '/api/bounty-requests/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounty-requests'],
        description: 'Get bounty request details by ID',
        params: z.object({
          id: z.string().uuid('Invalid request ID format'),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      request.log.info(
        { requestId: id, userId },
        'Fetching bounty request by ID'
      );

      try {
        const supabase = getSupabaseAdmin();

        const { data: bountyRequest, error } = await supabase
          .from('bounty_requests')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new NotFoundError('Bounty request', id);
          }
          request.log.error({ error: error.message, requestId: id }, 'Bounty request fetch failed');
          throw new Error(error.message);
        }

        if (!bountyRequest) {
          throw new NotFoundError('Bounty request', id);
        }

        // Authorization: Check if user is the hunter or the bounty owner
        const isHunter = bountyRequest.hunter_id === userId;
        
        // Fetch bounty to check ownership
        const { data: bounty } = await supabase
          .from('bounties')
          .select('user_id, poster_id')
          .eq('id', bountyRequest.bounty_id)
          .single();
        
        const posterId = bounty ? (bounty.poster_id || bounty.user_id) : null;
        const isPoster = posterId === userId;

        if (!isHunter && !isPoster) {
          request.log.warn(
            { userId, requestId: id, hunterId: bountyRequest.hunter_id, posterId },
            'Unauthorized access to bounty request'
          );
          throw new AuthorizationError('You are not authorized to view this request');
        }

        request.log.info(
          { requestId: id },
          'Bounty request fetched successfully'
        );

        return bountyRequest;
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof AuthorizationError) {
          throw error;
        }
        request.log.error({ error, requestId: id }, 'Unexpected error fetching bounty request');
        throw error;
      }
    })
  );

  /**
   * GET /api/bounty-requests/user/:userId
   * Get bounty requests by specific user ID
   * 
   * - Requires authentication
   * - Returns requests where the specified user is the hunter (applicant)
   * - Authorization: Users can only view their own requests, or requests for their bounties
   * 
   * @param {string} userId - User UUID
   * @returns {200} Array of bounty requests
   * @returns {401} Authentication required
   * @returns {403} Not authorized to view these requests
   */
  fastify.get(
    '/api/bounty-requests/user/:userId',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounty-requests'],
        description: 'Get bounty requests by user ID',
        params: z.object({
          userId: z.string().uuid('Invalid user ID format'),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { userId: targetUserId } = request.params as { userId: string };
      const userId = request.userId!;

      request.log.info(
        { targetUserId, userId },
        'Fetching bounty requests by user ID'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Query by hunter_id (the canonical applicant column)
        const { data: requests, error } = await supabase
          .from('bounty_requests')
          .select('*')
          .eq('hunter_id', targetUserId)
          .order('created_at', { ascending: false });

        if (error) {
          request.log.error({ error: error.message, targetUserId }, 'Bounty requests fetch failed');
          throw new Error(error.message);
        }

        // Authorization: Users can view their own applications or applications for their bounties
        if (targetUserId !== userId) {
          // If not viewing own applications, check if any are for user's bounties
          if (requests && requests.length > 0) {
            const bountyIds = [...new Set(requests.map(r => r.bounty_id))];
            const { data: bounties } = await supabase
              .from('bounties')
              .select('id, user_id, poster_id')
              .in('id', bountyIds);
            
            // Filter to only requests for this user's bounties
            const userBountyIds = new Set(
              bounties?.filter(b => (b.poster_id || b.user_id) === userId).map(b => b.id) || []
            );
            
            const authorizedRequests = requests.filter(req => 
              userBountyIds.has(req.bounty_id)
            );

            request.log.info(
              { count: authorizedRequests.length },
              'Bounty requests by user fetched successfully'
            );

            return authorizedRequests;
          }
        }

        request.log.info(
          { count: requests?.length || 0 },
          'Bounty requests by user fetched successfully'
        );

        return requests || [];
      } catch (error) {
        request.log.error({ error, targetUserId }, 'Unexpected error fetching bounty requests by user');
        throw error;
      }
    })
  );

  /**
   * POST /api/bounty-requests
   * Create a new bounty request/application
   * 
   * - Requires authentication
   * - Validates bounty exists and is 'open'
   * - Cannot apply to own bounty
   * - Cannot apply twice to same bounty (unique constraint)
   * - Sets status = 'pending', hunter_id = authenticated user
   * 
   * @header {string} Authorization - Bearer token (required)
   * @body {string} bounty_id - Bounty UUID (required)
   * @body {string} message - Application message (required, 50-1000 chars)
   * @body {string} proposed_completion_date - Proposed completion date (ISO 8601, optional)
   * 
   * @returns {201} Bounty request created successfully
   * @returns {400} Validation error
   * @returns {401} Authentication required
   * @returns {404} Bounty not found
   * @returns {409} Already applied or trying to apply to own bounty
   */
  fastify.post(
    '/api/bounty-requests',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounty-requests'],
        description: 'Create a new bounty request/application',
        body: createRequestSchema,
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              bounty_id: { type: 'string' },
              hunter_id: { type: 'string' },
              status: { type: 'string' },
              created_at: { type: 'string' },
            },
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = createRequestSchema.parse(request.body);

      request.log.info(
        { userId, bountyId: body.bounty_id },
        'Creating bounty request'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Lookup bounty to validate it exists and is open
        const { data: bounty, error: bountyError } = await supabase
          .from('bounties')
          .select('id, user_id, poster_id, status')
          .eq('id', body.bounty_id)
          .single();

        if (bountyError) {
          if (bountyError.code === 'PGRST116') {
            throw new NotFoundError('Bounty', body.bounty_id);
          }
          throw new Error(bountyError.message);
        }

        if (!bounty) {
          throw new NotFoundError('Bounty', body.bounty_id);
        }

        // Get the poster_id (with fallback to user_id)
        const posterId = getBountyPosterId(bounty);
        
        if (!posterId) {
          throw new ValidationError('Bounty missing poster information');
        }

        // Check if user is trying to apply to their own bounty
        if (posterId === userId) {
          throw new ValidationError('You cannot apply to your own bounty. Only other users can submit applications.');
        }

        // Validate bounty is open
        if (bounty.status !== 'open') {
          throw new ConflictError(`Cannot apply to bounty with status: ${bounty.status}`);
        }

        // Check for existing application
        const { data: existingRequest } = await supabase
          .from('bounty_requests')
          .select('id')
          .eq('bounty_id', body.bounty_id)
          .eq('hunter_id', userId)
          .maybeSingle();

        if (existingRequest) {
          throw new ConflictError('You have already applied to this bounty');
        }

        // Prepare request data
        const requestData: Partial<BountyRequest> = {
          bounty_id: body.bounty_id,
          hunter_id: userId,
          poster_id: posterId,
          status: 'pending',
          message: body.message,  // Now required by schema
        };

        if (body.proposed_completion_date) {
          requestData.proposed_completion_date = body.proposed_completion_date;
        }

        // Create bounty request
        const { data: bountyRequest, error: createError } = await supabase
          .from('bounty_requests')
          .insert(requestData)
          .select()
          .single();

        if (createError) {
          // Handle duplicate entry error
          if (createError.code === '23505') {
            throw new ConflictError('You have already applied to this bounty');
          }
          request.log.error(
            { error: createError.message, userId, bountyId: body.bounty_id },
            'Bounty request creation failed'
          );
          throw new Error(createError.message);
        }

        request.log.info(
          { userId, requestId: bountyRequest.id, bountyId: body.bounty_id },
          'Bounty request created successfully'
        );

        reply.code(201);
        return bountyRequest;
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof ValidationError || 
            error instanceof ConflictError) {
          throw error;
        }
        request.log.error(
          { error, userId, bountyId: body.bounty_id },
          'Unexpected error creating bounty request'
        );
        throw error;
      }
    })
  );

  /**
   * PATCH /api/bounty-requests/:id
   * Update bounty request status
   * 
   * - Requires authentication
   * - Authorization:
   *   - Bounty owner can accept/reject requests
   *   - Applicant can withdraw their request
   * - Cannot update if bounty is not 'open' (except for withdraw)
   * 
   * Special logic for accepting:
   * - Update bounty: status='in_progress', accepted_by=hunter_id
   * - Update this request: status='accepted'
   * - Reject all other pending requests for the same bounty
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Bounty request UUID
   * @body {string} status - New status: accepted, rejected, or withdrawn
   * 
   * @returns {200} Bounty request updated successfully
   * @returns {400} Validation error
   * @returns {401} Authentication required
   * @returns {403} Not authorized to perform this action
   * @returns {404} Bounty request not found
   * @returns {409} Invalid status transition
   */
  fastify.patch(
    '/api/bounty-requests/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounty-requests'],
        description: 'Update bounty request status',
        params: z.object({
          id: z.string().uuid('Invalid request ID format'),
        }),
        body: updateRequestSchema,
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id: requestId } = request.params as { id: string };
      const userId = request.userId!;
      const body = updateRequestSchema.parse(request.body);

      request.log.info(
        { userId, requestId, newStatus: body.status },
        'Updating bounty request'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Fetch existing request
        const { data: bountyRequest, error: fetchError } = await supabase
          .from('bounty_requests')
          .select('*')
          .eq('id', requestId)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            throw new NotFoundError('Bounty request', requestId);
          }
          throw new Error(fetchError.message);
        }

        if (!bountyRequest) {
          throw new NotFoundError('Bounty request', requestId);
        }

        // Fetch associated bounty
        const { data: bounty, error: bountyError } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', bountyRequest.bounty_id)
          .single();

        if (bountyError || !bounty) {
          throw new NotFoundError('Bounty', bountyRequest.bounty_id);
        }

        const posterId = getBountyPosterId(bounty);

        // Authorization checks based on action
        if (body.status === 'withdrawn') {
          // Only applicant can withdraw
          if (bountyRequest.hunter_id !== userId) {
            throw new AuthorizationError('Only the applicant can withdraw this request');
          }
          // Can only withdraw pending requests
          if (bountyRequest.status !== 'pending') {
            throw new ConflictError(`Cannot withdraw request with status: ${bountyRequest.status}`);
          }
        } else if (body.status === 'accepted' || body.status === 'rejected') {
          // Only bounty owner can accept/reject
          if (posterId !== userId) {
            throw new AuthorizationError('Only the bounty owner can accept or reject requests');
          }
          // Can only accept/reject if bounty is still open
          if (bounty.status !== 'open') {
            throw new ConflictError(`Cannot accept/reject request when bounty status is: ${bounty.status}`);
          }
          // Can only accept/reject pending requests
          if (bountyRequest.status !== 'pending') {
            throw new ConflictError(`Cannot accept/reject request with status: ${bountyRequest.status}`);
          }
        }

        // Special logic for accepting a request
        if (body.status === 'accepted') {
          // This is a critical operation - use optimistic locking to prevent race conditions
          // 1. Update the bounty status and accepted_by
          const { data: updatedBounty, error: bountyUpdateError } = await supabase
            .from('bounties')
            .update({
              status: 'in_progress',
              accepted_by: bountyRequest.hunter_id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', bountyRequest.bounty_id)
            .eq('status', 'open')  // Optimistic lock: only update if still open
            .select()
            .single();

          if (bountyUpdateError || !updatedBounty) {
            request.log.error(
              { error: bountyUpdateError?.message, bountyId: bountyRequest.bounty_id },
              'Failed to update bounty when accepting request (possibly already accepted)'
            );
            throw new ConflictError('This bounty has already been accepted by another user');
          }

          // 2. Update this request to accepted
          const { data: updatedRequest, error: requestUpdateError } = await supabase
            .from('bounty_requests')
            .update({
              status: 'accepted',
              updated_at: new Date().toISOString(),
            })
            .eq('id', requestId)
            .select()
            .single();

          if (requestUpdateError || !updatedRequest) {
            request.log.error(
              { error: requestUpdateError?.message, requestId },
              'Failed to update request status to accepted, attempting to roll back bounty'
            );

            // Compensating action: roll back the bounty to open if possible
            const { error: bountyRollbackError } = await supabase
              .from('bounties')
              .update({
                status: 'open',
                accepted_by: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', bountyRequest.bounty_id)
              .eq('status', 'in_progress')
              .eq('accepted_by', bountyRequest.hunter_id);

            if (bountyRollbackError) {
              request.log.error(
                {
                  error: bountyRollbackError.message,
                  bountyId: bountyRequest.bounty_id,
                  hunterId: bountyRequest.hunter_id,
                },
                'Failed to roll back bounty after request accept failure - manual intervention required'
              );
            }

            throw new Error('Failed to accept request');
          }

          // 3. Reject all other pending requests for this bounty
          const { error: rejectOthersError } = await supabase
            .from('bounty_requests')
            .update({
              status: 'rejected',
              updated_at: new Date().toISOString(),
            })
            .eq('bounty_id', bountyRequest.bounty_id)
            .eq('status', 'pending')
            .neq('id', requestId);

          if (rejectOthersError) {
            request.log.warn(
              { error: rejectOthersError.message, bountyId: bountyRequest.bounty_id },
              'Failed to reject other pending requests (continuing)'
            );
            // Don't fail the whole operation if this fails
          }

          request.log.info(
            { userId, requestId, bountyId: bountyRequest.bounty_id },
            'Bounty request accepted successfully'
          );

          return updatedRequest;
        }

        // For reject and withdraw, just update the request status
        const { data: updatedRequest, error: updateError } = await supabase
          .from('bounty_requests')
          .update({
            status: body.status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', requestId)
          .select()
          .single();

        if (updateError) {
          request.log.error(
            { error: updateError.message, requestId },
            'Bounty request update failed'
          );
          throw new Error(updateError.message);
        }

        request.log.info(
          { userId, requestId, newStatus: body.status },
          'Bounty request updated successfully'
        );

        return updatedRequest;
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof AuthorizationError || 
            error instanceof ConflictError ||
            error instanceof ValidationError) {
          throw error;
        }
        request.log.error(
          { error, requestId },
          'Unexpected error updating bounty request'
        );
        throw error;
      }
    })
  );

  /**
   * DELETE /api/bounty-requests/:id
   * Delete/withdraw bounty request
   * 
   * - Requires authentication
   * - Authorization: Only applicant can delete if status = 'pending'
   * - Cannot delete 'accepted' requests (must use withdraw status instead)
   * 
   * @header {string} Authorization - Bearer token (required)
   * @param {string} id - Bounty request UUID
   * 
   * @returns {200} Bounty request deleted successfully
   * @returns {401} Authentication required
   * @returns {403} Not authorized to delete this request
   * @returns {404} Bounty request not found
   * @returns {409} Cannot delete accepted request
   */
  fastify.delete(
    '/api/bounty-requests/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['bounty-requests'],
        description: 'Delete bounty request (applicant only, pending status only)',
        params: z.object({
          id: z.string().uuid('Invalid request ID format'),
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
      const { id: requestId } = request.params as { id: string };
      const userId = request.userId!;

      request.log.info(
        { userId, requestId },
        'Deleting bounty request'
      );

      try {
        const supabase = getSupabaseAdmin();

        // Fetch existing request to check ownership and status
        const { data: bountyRequest, error: fetchError } = await supabase
          .from('bounty_requests')
          .select('*')
          .eq('id', requestId)
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            throw new NotFoundError('Bounty request', requestId);
          }
          throw new Error(fetchError.message);
        }

        if (!bountyRequest) {
          throw new NotFoundError('Bounty request', requestId);
        }

        // Check authorization: only applicant can delete
        if (bountyRequest.hunter_id !== userId) {
          request.log.warn(
            { userId, requestId, hunterId: bountyRequest.hunter_id },
            'Attempted to delete another user request'
          );
          throw new AuthorizationError('Only the applicant can delete this request');
        }

        // Check status: cannot delete accepted requests
        if (bountyRequest.status === 'accepted') {
          throw new ConflictError('Cannot delete accepted request; use the withdraw status instead or contact support if needed.');
        }

        // Only allow deleting pending requests
        if (bountyRequest.status !== 'pending') {
          throw new ConflictError(`Cannot delete request with status: ${bountyRequest.status}`);
        }

        // Delete request
        const { error: deleteError } = await supabase
          .from('bounty_requests')
          .delete()
          .eq('id', requestId);

        if (deleteError) {
          request.log.error(
            { error: deleteError.message, requestId },
            'Bounty request deletion failed'
          );
          throw new Error(deleteError.message);
        }

        request.log.info(
          { userId, requestId },
          'Bounty request deleted successfully'
        );

        return {
          success: true,
          message: 'Bounty request deleted successfully',
        };
      } catch (error) {
        if (error instanceof NotFoundError || 
            error instanceof AuthorizationError || 
            error instanceof ConflictError) {
          throw error;
        }
        request.log.error(
          { error, requestId },
          'Unexpected error deleting bounty request'
        );
        throw error;
      }
    })
  );

  fastify.log.info('Consolidated bounty request routes registered');
}
