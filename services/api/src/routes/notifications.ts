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

  const q = request.query as any;
  const limit = Number(q?.limit) || 50;
  const offset = Number(q?.offset) || 0;

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
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error fetching unread count:', errorMsg, error);
      return reply.code(500).send({ 
        error: 'Failed to fetch unread count',
        details: errorMsg
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error registering push token:', errorMsg, error);
      return reply.code(500).send({ 
        error: 'Failed to register push token',
        details: errorMsg
      });
    }
  });

  // Get notification preferences
  fastify.get('/notifications/preferences', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const preferences = await notificationService.getPreferences(request.userId);

      return { preferences };
    } catch (error) {
      console.error('Error fetching notification preferences:', error);
      return reply.code(500).send({ 
        error: 'Failed to fetch notification preferences',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update notification preferences
  fastify.post('/notifications/preferences', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const preferences = request.body as {
        applications_enabled?: boolean;
        acceptances_enabled?: boolean;
        completions_enabled?: boolean;
        payments_enabled?: boolean;
        messages_enabled?: boolean;
        follows_enabled?: boolean;
        reminders_enabled?: boolean;
        system_enabled?: boolean;
      };

      const updated = await notificationService.updatePreferences(request.userId, preferences);

      return { preferences: updated };
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      return reply.code(500).send({ 
        error: 'Failed to update notification preferences',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('✅ Notification routes registered');
}
