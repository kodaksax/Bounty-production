import { FastifyInstance } from 'fastify';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { notificationService } from '../services/notification-service';

export async function registerNotificationRoutes(fastify: FastifyInstance) {
  // Get notifications for current user
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/notifications', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const limit = Number(request.query?.limit) || 50;
      const offset = Number(request.query?.offset) || 0;

      const notifications = await notificationService.getNotifications(
        request.userId,
        limit,
        offset
      );

      return { notifications };
    } catch (error) {
      console.error('Error fetching notifications:', error);
      return reply.code(500).send({ 
        error: 'Failed to fetch notifications',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get unread count
  fastify.get('/notifications/unread-count', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const count = await notificationService.getUnreadCount(request.userId);

      return { count };
    } catch (error) {
      console.error('Error fetching unread count:', error);
      return reply.code(500).send({ 
        error: 'Failed to fetch unread count',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Mark notification(s) as read
  fastify.post('/notifications/mark-read', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { notificationIds } = request.body as { notificationIds: string[] };

      if (!notificationIds || !Array.isArray(notificationIds)) {
        return reply.code(400).send({ error: 'notificationIds array is required' });
      }

      await notificationService.markAsRead(notificationIds);

      return { success: true };
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      return reply.code(500).send({ 
        error: 'Failed to mark notifications as read',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Mark all notifications as read
  fastify.post('/notifications/mark-all-read', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      await notificationService.markAllAsRead(request.userId);

      return { success: true };
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      return reply.code(500).send({ 
        error: 'Failed to mark all notifications as read',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Register push notification token
  fastify.post('/notifications/register-token', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { token, deviceId } = request.body as { token: string; deviceId?: string };

      if (!token || typeof token !== 'string') {
        return reply.code(400).send({ error: 'token is required' });
      }

      await notificationService.registerPushToken(request.userId, token, deviceId);

      return { success: true };
    } catch (error) {
      console.error('Error registering push token:', error);
      return reply.code(500).send({ 
        error: 'Failed to register push token',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('✅ Notification routes registered');
}
