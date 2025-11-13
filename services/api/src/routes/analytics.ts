// services/api/src/routes/analytics.ts - Analytics routes for admin dashboard
import { FastifyInstance } from 'fastify';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { logger, analyticsLogger } from '../services/logger';

/**
 * Register analytics routes
 * All routes in this module require admin authentication
 */
export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  // Get analytics metrics
  fastify.get('/admin/analytics/metrics', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      // TODO: Fetch real analytics from Mixpanel or database
      // For now, returning mock data structure that matches the frontend

      const metrics = {
        // User metrics
        totalUsers: 1250,
        activeUsersToday: 45,
        activeUsersWeek: 320,
        newUsersToday: 8,
        newUsersWeek: 52,

        // Event metrics
        totalEvents: 15420,
        eventsToday: 340,
        eventsWeek: 2450,

        // Top events
        topEvents: [
          { name: 'bounty_viewed', count: 520 },
          { name: 'message_sent', count: 410 },
          { name: 'bounty_created', count: 85 },
          { name: 'bounty_accepted', count: 62 },
          { name: 'payment_completed', count: 48 },
        ],

        // Bounty metrics
        bountiesCreatedToday: 12,
        bountiesCreatedWeek: 85,
        bountiesAcceptedToday: 8,
        bountiesAcceptedWeek: 62,
        bountiesCompletedToday: 5,
        bountiesCompletedWeek: 48,

        // Payment metrics
        paymentsToday: 5,
        paymentsWeek: 48,
        revenueToday: 450.0,
        revenueWeek: 3820.5,

        // Messaging metrics
        messagesToday: 120,
        messagesWeek: 890,
        conversationsToday: 18,
        conversationsWeek: 125,

        // Error tracking
        errorsToday: 3,
        errorsWeek: 24,
        topErrors: [
          { message: 'Network request failed', count: 8 },
          { message: 'Invalid bounty ID', count: 5 },
          { message: 'Payment processing error', count: 3 },
        ],
      };

      analyticsLogger.info({ userId: request.user?.id }, 'Admin fetched analytics metrics');

      return reply.send(metrics);
    } catch (error) {
      logger.error({ err: error }, 'Error fetching analytics metrics');
      return reply.code(500).send({
        error: 'Failed to fetch analytics',
        message: 'An error occurred while retrieving analytics metrics',
      });
    }
  });

  // Get event logs (recent events for debugging)
  fastify.get('/admin/analytics/events', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { limit = 50, eventType } = request.query as {
        limit?: number;
        eventType?: string;
      };

      // TODO: Fetch real event logs from database or Mixpanel
      // For now, returning mock data

      const events = Array.from({ length: Math.min(limit, 20) }, (_, i) => ({
        id: `evt_${Date.now()}_${i}`,
        event: eventType || ['bounty_created', 'message_sent', 'payment_completed'][i % 3],
        userId: `user_${Math.floor(Math.random() * 100)}`,
        timestamp: new Date(Date.now() - i * 60000).toISOString(),
        properties: {
          platform: 'mobile',
          version: '1.0.0',
        },
      }));

      analyticsLogger.info(
        { userId: request.user?.id, eventType, limit },
        'Admin fetched event logs'
      );

      return reply.send({
        events,
        total: events.length,
        hasMore: events.length === limit,
      });
    } catch (error) {
      logger.error({ err: error }, 'Error fetching event logs');
      return reply.code(500).send({
        error: 'Failed to fetch events',
        message: 'An error occurred while retrieving event logs',
      });
    }
  });

  // Get user analytics
  fastify.get('/admin/analytics/users/:userId', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      // TODO: Fetch real user analytics from Mixpanel
      // For now, returning mock data

      const userAnalytics = {
        userId,
        events: {
          total: 150,
          last7Days: 35,
          last30Days: 120,
        },
        bountiesCreated: 5,
        bountiesCompleted: 3,
        messagesSent: 45,
        lastActive: new Date().toISOString(),
        topEvents: [
          { name: 'message_sent', count: 45 },
          { name: 'bounty_viewed', count: 30 },
          { name: 'bounty_created', count: 5 },
        ],
      };

      analyticsLogger.info(
        { adminUserId: request.user?.id, targetUserId: userId },
        'Admin fetched user analytics'
      );

      return reply.send(userAnalytics);
    } catch (error) {
      logger.error({ err: error }, 'Error fetching user analytics');
      return reply.code(500).send({
        error: 'Failed to fetch user analytics',
        message: 'An error occurred while retrieving user analytics',
      });
    }
  });

  // Export analytics data (for reports)
  fastify.get('/admin/analytics/export', {
    preHandler: adminMiddleware,
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { startDate, endDate, format = 'json' } = request.query as {
        startDate?: string;
        endDate?: string;
        format?: 'json' | 'csv';
      };

      // TODO: Implement real export functionality
      // This would fetch data from Mixpanel and format it

      const exportData = {
        generatedAt: new Date().toISOString(),
        dateRange: {
          start: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: endDate || new Date().toISOString(),
        },
        summary: {
          totalEvents: 15420,
          uniqueUsers: 850,
          totalBounties: 320,
          totalRevenue: 12450.75,
        },
      };

      analyticsLogger.info(
        { userId: request.user?.id, startDate, endDate, format },
        'Admin exported analytics data'
      );

      if (format === 'csv') {
        // TODO: Convert to CSV format
        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', 'attachment; filename=analytics-export.csv')
          .send('CSV export not yet implemented');
      }

      return reply.send(exportData);
    } catch (error) {
      logger.error({ err: error }, 'Error exporting analytics');
      return reply.code(500).send({
        error: 'Failed to export analytics',
        message: 'An error occurred while exporting analytics data',
      });
    }
  });
}
