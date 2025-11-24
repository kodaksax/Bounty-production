import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../middleware/auth';
import { staleBountyService } from '../services/stale-bounty-service';

interface CancelStaleBountyRequest extends AuthenticatedRequest {
  Params: {
    bountyId: string;
  };
}

interface RepostStaleBountyRequest extends AuthenticatedRequest {
  Params: {
    bountyId: string;
  };
}

export async function registerStaleBountyRoutes(fastify: FastifyInstance) {
  const { authMiddleware } = await import('../middleware/auth');

  /**
   * GET /stale-bounties
   * Get all stale bounties for the authenticated user (as poster)
   */
  fastify.get('/stale-bounties', {
    preHandler: authMiddleware,
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const staleBounties = await staleBountyService.getStaleBountiesForPoster(request.userId);
      
      return {
        success: true,
        bounties: staleBounties,
        count: staleBounties.length,
      };
    } catch (error) {
      console.error('Error fetching stale bounties:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch stale bounties',
      });
    }
  });

  /**
   * POST /stale-bounties/:bountyId/cancel
   * Cancel a stale bounty and process refund
   */
  fastify.post<CancelStaleBountyRequest>('/stale-bounties/:bountyId/cancel', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const { bountyId } = request.params;
      const result = await staleBountyService.cancelStaleBounty(bountyId, request.userId);
      
      if (!result.success) {
        return reply.code(400).send({
          success: false,
          error: result.error || 'Failed to cancel stale bounty',
        });
      }

      return {
        success: true,
        message: 'Stale bounty cancelled successfully. Refund is being processed.',
      };
    } catch (error) {
      console.error('Error cancelling stale bounty:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to cancel stale bounty',
      });
    }
  });

  /**
   * POST /stale-bounties/:bountyId/repost
   * Repost a stale bounty (reset to open status)
   */
  fastify.post<RepostStaleBountyRequest>('/stale-bounties/:bountyId/repost', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const { bountyId } = request.params;
      const result = await staleBountyService.repostStaleBounty(bountyId, request.userId);
      
      if (!result.success) {
        return reply.code(400).send({
          success: false,
          error: result.error || 'Failed to repost stale bounty',
        });
      }

      return {
        success: true,
        message: 'Stale bounty reposted successfully. It is now open for new hunters.',
      };
    } catch (error) {
      console.error('Error reposting stale bounty:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to repost stale bounty',
      });
    }
  });
}
