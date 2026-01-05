import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logErrorWithContext, getRequestContext } from '../middleware/request-context';
import type { AuthenticatedRequest } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { db } from '../db/connection';
import { bounties, users } from '../db/schema';
import { eq, and, or, gte, lte, ilike, sql, desc, asc } from 'drizzle-orm';

interface BountySearchQuery {
  keywords?: string;
  location?: string;
  minAmount?: string;
  maxAmount?: string;
  status?: string;
  workType?: 'online' | 'in_person';
  isForHonor?: string;
  sortBy?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  limit?: string;
  offset?: string;
}

interface UserSearchQuery {
  keywords?: string;
  skills?: string;
  location?: string;
  sortBy?: 'relevance' | 'date_desc';
  limit?: string;
  offset?: string;
}

export async function registerSearchRoutes(fastify: FastifyInstance) {
  // Bounty search endpoint with advanced filtering
  fastify.get('/api/bounties/search', {
    preHandler: authMiddleware
  }, async (request: any, reply: FastifyReply) => {
    try {
      const {
        keywords,
        location,
        minAmount,
        maxAmount,
        status,
        workType,
        isForHonor,
        sortBy = 'date_desc',
        limit = '20',
        offset = '0',
      } = request.query as BountySearchQuery;

      const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      // Build query conditions
      const conditions: any[] = [];

      // Keyword search on title and description
      if (keywords) {
        conditions.push(
          or(
            ilike(bounties.title, `%${keywords}%`),
            ilike(bounties.description, `%${keywords}%`)
          )
        );
      }

      // Location filter
      if (location) {
        // Assuming bounties table doesn't have location field in schema
        // This would need to be added to the schema if location-based search is needed
      }

      // Amount range filters (convert to cents)
      if (minAmount) {
        const minCents = Math.floor(parseFloat(minAmount) * 100);
        conditions.push(gte(bounties.amount_cents, minCents));
      }

      if (maxAmount) {
        const maxCents = Math.floor(parseFloat(maxAmount) * 100);
        conditions.push(lte(bounties.amount_cents, maxCents));
      }

      // Status filter
      if (status) {
        conditions.push(eq(bounties.status, status));
      } else {
        // Default: exclude archived
        conditions.push(sql`${bounties.status} != 'archived'`);
      }

      // Work type filter
      // Note: work_type is not in the current schema, would need to be added

      // Is for honor filter
      if (isForHonor !== undefined) {
        conditions.push(eq(bounties.is_for_honor, isForHonor === 'true'));
      }

      // Build the query
      let query = db
        .select({
          id: bounties.id,
          creator_id: bounties.creator_id,
          hunter_id: bounties.hunter_id,
          title: bounties.title,
          description: bounties.description,
          amount_cents: bounties.amount_cents,
          is_for_honor: bounties.is_for_honor,
          status: bounties.status,
          created_at: bounties.created_at,
          updated_at: bounties.updated_at,
          creator_handle: users.handle,
        })
        .from(bounties)
        .leftJoin(users, eq(bounties.creator_id, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      // Apply sorting
      let orderedQuery: any = query;
      switch (sortBy) {
        case 'date_desc':
          orderedQuery = query.orderBy(desc(bounties.created_at));
          break;
        case 'date_asc':
          orderedQuery = query.orderBy(asc(bounties.created_at));
          break;
        case 'amount_desc':
          orderedQuery = query.orderBy(desc(bounties.amount_cents));
          break;
        case 'amount_asc':
          orderedQuery = query.orderBy(asc(bounties.amount_cents));
          break;
        default:
          orderedQuery = query.orderBy(desc(bounties.created_at));
      }

      // Apply pagination
      const results = await orderedQuery.limit(limitNum).offset(offsetNum);

      // Transform results to match frontend expectations
      const bountyResults = results.map((row: any) => ({
        id: row.id,
        creator_id: row.creator_id,
        hunter_id: row.hunter_id,
        title: row.title,
        description: row.description,
        amount: row.amount_cents ? row.amount_cents / 100 : 0,
        amount_cents: row.amount_cents,
        is_for_honor: row.is_for_honor,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        poster_id: row.creator_id,
        user_id: row.creator_id,
        username: row.creator_handle,
      }));

      return {
        results: bountyResults,
        total: bountyResults.length,
        page: Math.floor(offsetNum / limitNum) + 1,
        pageSize: limitNum,
        hasMore: bountyResults.length === limitNum,
      };
    } catch (error) {
      console.error('Error in /api/bounties/search:', error);
      return reply.code(500).send({
        error: 'Failed to search bounties',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // User search endpoint
  fastify.get('/api/users/search', {
    preHandler: authMiddleware
  }, async (request: any, reply: FastifyReply) => {
    try {
      const {
        keywords,
        skills,
        location,
        sortBy = 'relevance',
        limit = '20',
        offset = '0',
      } = request.query as UserSearchQuery;

      const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      // Build query conditions
      const conditions: any[] = [];

      // Keyword search on handle (username)
      if (keywords) {
        conditions.push(ilike(users.handle, `%${keywords}%`));
      }

      // Build the query
      let query = db
        .select({
          id: users.id,
          handle: users.handle,
          stripe_account_id: users.stripe_account_id,
          created_at: users.created_at,
        })
        .from(users)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      // Apply sorting
      let orderedQuery: any = query;
      switch (sortBy) {
        case 'date_desc':
          orderedQuery = query.orderBy(desc(users.created_at));
          break;
        case 'relevance':
        default:
          orderedQuery = query.orderBy(desc(users.created_at));
          break;
      }

      // Apply pagination
      const results = await orderedQuery.limit(limitNum).offset(offsetNum);

      // Transform results to match frontend expectations
      const userResults = results.map((user: any) => ({
        id: user.id,
        username: user.handle,
        name: user.handle.replace('@', ''),
        joinDate: user.created_at,
        verificationStatus: 'unverified' as const,
        followerCount: 0,
        followingCount: 0,
      }));

      return {
        results: userResults,
        total: userResults.length,
        page: Math.floor(offsetNum / limitNum) + 1,
        pageSize: limitNum,
        hasMore: userResults.length === limitNum,
      };
    } catch (error) {
      console.error('Error in /api/users/search:', error);
      return reply.code(500).send({
        error: 'Failed to search users',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Get search suggestions for autocomplete
  fastify.get('/api/search/suggestions', {
    preHandler: authMiddleware
  }, async (request: any, reply: FastifyReply) => {
    try {
      const { q, type = 'bounty' } = request.query as { q: string; type?: 'bounty' | 'user' };

      if (!q || q.trim().length < 2) {
        return { suggestions: [] };
      }

      if (type === 'bounty') {
        const results = await db
          .select({
            id: bounties.id,
            title: bounties.title,
          })
          .from(bounties)
          .where(
            and(
              or(
                ilike(bounties.title, `%${q}%`),
                ilike(bounties.description, `%${q}%`)
              ),
              sql`${bounties.status} != 'archived'`
            )
          )
          .orderBy(desc(bounties.created_at))
          .limit(5);

        return {
          suggestions: results.map(r => ({
            id: r.id,
            text: r.title,
            type: 'bounty',
          })),
        };
      } else {
        const results = await db
          .select({
            id: users.id,
            handle: users.handle,
          })
          .from(users)
          .where(ilike(users.handle, `%${q}%`))
          .orderBy(desc(users.created_at))
          .limit(5);

        return {
          suggestions: results.map(r => ({
            id: r.id,
            text: r.handle,
            type: 'user',
          })),
        };
      }
    } catch (error) {
      console.error('Error in /api/search/suggestions:', error);
      return reply.code(500).send({
        error: 'Failed to get suggestions',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
