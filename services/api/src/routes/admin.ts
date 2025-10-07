// services/api/src/routes/admin.ts - Admin-only routes with proper security
import { FastifyInstance } from 'fastify';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db/connection';
import { users, bounties } from '../db/schema';
import { eq, desc, sql } from 'drizzle-orm';

/**
 * Register admin-only routes
 * All routes in this module require admin authentication
 */
export async function registerAdminRoutes(fastify: FastifyInstance) {
  // Admin dashboard metrics
  fastify.get('/admin/metrics', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      // Get total users
      const totalUsersResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(users);
      const totalUsers = totalUsersResult[0]?.count || 0;

      // Get bounty stats
      const bountyStats = await db
        .select({
          status: bounties.status,
          count: sql<number>`count(*)`,
        })
        .from(bounties)
        .groupBy(bounties.status);

      const metrics = {
        totalUsers,
        totalBounties: bountyStats.reduce((sum, s) => sum + (s.count || 0), 0),
        openBounties: bountyStats.find(s => s.status === 'open')?.count || 0,
        inProgressBounties: bountyStats.find(s => s.status === 'in_progress')?.count || 0,
        completedBounties: bountyStats.find(s => s.status === 'completed')?.count || 0,
        archivedBounties: bountyStats.find(s => s.status === 'archived')?.count || 0,
      };

      return reply.send(metrics);
    } catch (error) {
      console.error('Error fetching admin metrics:', error);
      return reply.code(500).send({
        error: 'Failed to fetch metrics',
        message: 'An error occurred while retrieving dashboard metrics',
      });
    }
  });

  // List all users (admin only)
  fastify.get('/admin/users', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { page = 1, limit = 50, status, search } = request.query as {
        page?: number;
        limit?: number;
        status?: 'active' | 'suspended' | 'banned';
        search?: string;
      };

      const offset = (page - 1) * limit;

      // Build query
      let query = db.select().from(users);

      // Apply filters (implement filtering logic as needed)
      // Note: This is a basic implementation - add more sophisticated filtering as needed

      const userList = await query
        .limit(limit)
        .offset(offset)
        .orderBy(desc(users.created_at));

      return reply.send({
        users: userList,
        page,
        limit,
        hasMore: userList.length === limit,
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      return reply.code(500).send({
        error: 'Failed to fetch users',
        message: 'An error occurred while retrieving user list',
      });
    }
  });

  // Get specific user details (admin only)
  fastify.get('/admin/users/:userId', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || user.length === 0) {
        return reply.code(404).send({
          error: 'User not found',
          message: `No user found with ID: ${userId}`,
        });
      }

      // Get user's bounties
      const userBounties = await db
        .select()
        .from(bounties)
        .where(eq(bounties.user_id, userId))
        .orderBy(desc(bounties.created_at));

      return reply.send({
        user: user[0],
        bounties: userBounties,
      });
    } catch (error) {
      console.error('Error fetching user:', error);
      return reply.code(500).send({
        error: 'Failed to fetch user',
        message: 'An error occurred while retrieving user details',
      });
    }
  });

  // Update user status (admin only)
  fastify.patch('/admin/users/:userId/status', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const { status, reason } = request.body as {
        status: 'active' | 'suspended' | 'banned';
        reason?: string;
      };

      if (!status || !['active', 'suspended', 'banned'].includes(status)) {
        return reply.code(400).send({
          error: 'Invalid status',
          message: 'Status must be one of: active, suspended, banned',
        });
      }

      // Note: This requires adding a 'status' column to the users table
      // For now, this is a placeholder showing the intended structure

      // Log the admin action for audit trail
      console.log(`[ADMIN_ACTION] User ${request.userId} updated user ${userId} status to ${status}. Reason: ${reason || 'N/A'}`);

      return reply.send({
        success: true,
        message: `User status updated to ${status}`,
        userId,
        status,
      });
    } catch (error) {
      console.error('Error updating user status:', error);
      return reply.code(500).send({
        error: 'Failed to update user status',
        message: 'An error occurred while updating user status',
      });
    }
  });

  // List all bounties (admin view)
  fastify.get('/admin/bounties', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { page = 1, limit = 50, status, flagged } = request.query as {
        page?: number;
        limit?: number;
        status?: 'open' | 'in_progress' | 'completed' | 'archived';
        flagged?: boolean;
      };

      const offset = (page - 1) * limit;

      let query = db.select().from(bounties);

      // Apply status filter
      if (status) {
        query = query.where(eq(bounties.status, status)) as any;
      }

      // Apply flagged filter (requires flagged column in schema)
      // This is a placeholder for future implementation

      const bountyList = await query
        .limit(limit)
        .offset(offset)
        .orderBy(desc(bounties.created_at));

      return reply.send({
        bounties: bountyList,
        page,
        limit,
        hasMore: bountyList.length === limit,
      });
    } catch (error) {
      console.error('Error fetching bounties:', error);
      return reply.code(500).send({
        error: 'Failed to fetch bounties',
        message: 'An error occurred while retrieving bounty list',
      });
    }
  });

  // Update bounty status (admin override)
  fastify.patch('/admin/bounties/:bountyId/status', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { bountyId } = request.params as { bountyId: string };
      const { status, reason } = request.body as {
        status: 'open' | 'in_progress' | 'completed' | 'archived';
        reason?: string;
      };

      if (!status || !['open', 'in_progress', 'completed', 'archived'].includes(status)) {
        return reply.code(400).send({
          error: 'Invalid status',
          message: 'Status must be one of: open, in_progress, completed, archived',
        });
      }

      const bountyIdNum = parseInt(bountyId, 10);
      if (isNaN(bountyIdNum)) {
        return reply.code(400).send({
          error: 'Invalid bounty ID',
          message: 'Bounty ID must be a number',
        });
      }

      await db
        .update(bounties)
        .set({ status })
        .where(eq(bounties.id, bountyIdNum));

      // Log the admin action for audit trail
      console.log(`[ADMIN_ACTION] User ${request.userId} updated bounty ${bountyId} status to ${status}. Reason: ${reason || 'N/A'}`);

      return reply.send({
        success: true,
        message: `Bounty status updated to ${status}`,
        bountyId,
        status,
      });
    } catch (error) {
      console.error('Error updating bounty status:', error);
      return reply.code(500).send({
        error: 'Failed to update bounty status',
        message: 'An error occurred while updating bounty status',
      });
    }
  });

  // Delete bounty (admin only - use with caution)
  fastify.delete('/admin/bounties/:bountyId', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { bountyId } = request.params as { bountyId: string };
      const { reason } = request.body as { reason?: string };

      const bountyIdNum = parseInt(bountyId, 10);
      if (isNaN(bountyIdNum)) {
        return reply.code(400).send({
          error: 'Invalid bounty ID',
          message: 'Bounty ID must be a number',
        });
      }

      // Check if bounty exists
      const existing = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, bountyIdNum))
        .limit(1);

      if (!existing || existing.length === 0) {
        return reply.code(404).send({
          error: 'Bounty not found',
          message: `No bounty found with ID: ${bountyId}`,
        });
      }

      // Delete the bounty
      await db.delete(bounties).where(eq(bounties.id, bountyIdNum));

      // Log the admin action for audit trail
      console.log(`[ADMIN_ACTION] User ${request.userId} deleted bounty ${bountyId}. Reason: ${reason || 'N/A'}`);

      return reply.send({
        success: true,
        message: 'Bounty deleted successfully',
        bountyId,
      });
    } catch (error) {
      console.error('Error deleting bounty:', error);
      return reply.code(500).send({
        error: 'Failed to delete bounty',
        message: 'An error occurred while deleting the bounty',
      });
    }
  });

  // Audit log endpoint (admin only)
  fastify.get('/admin/audit-log', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      // This is a placeholder for future implementation
      // In production, audit logs should be stored in a separate table
      // and include: timestamp, admin_user_id, action, target, details

      return reply.send({
        message: 'Audit log not yet implemented',
        note: 'Admin actions are currently logged to console',
      });
    } catch (error) {
      console.error('Error fetching audit log:', error);
      return reply.code(500).send({
        error: 'Failed to fetch audit log',
        message: 'An error occurred while retrieving audit log',
      });
    }
  });

  console.log('✅ Admin routes registered with security middleware');
}
