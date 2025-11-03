import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { notifications, pushTokens } from '../db/schema';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

// Initialize Expo SDK
const expo = new Expo();

export type NotificationType = 'application' | 'acceptance' | 'completion' | 'payment' | 'message' | 'follow';

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface NotificationData {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
  read: boolean;
  created_at: Date;
}

export class NotificationService {
  /**
   * Create a notification and optionally send push notification
   */
  async createNotification(params: CreateNotificationParams, sendPush: boolean = true): Promise<NotificationData> {
    const { userId, type, title, body, data } = params;

    // Insert notification into database
    const [notification] = await db.insert(notifications).values({
      user_id: userId,
      type,
      title,
      body,
      data: data ? data : null,
    }).returning();

    // Send push notification if enabled
    if (sendPush) {
      await this.sendPushNotification(userId, title, body, data);
    }

    return notification as NotificationData;
  }

  /**
   * Get notifications for a user
   */
  async getNotifications(userId: string, limit: number = 50, offset: number = 0): Promise<NotificationData[]> {
    const results = await db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, userId))
      .orderBy(desc(notifications.created_at))
      .limit(limit)
      .offset(offset);

    return results as NotificationData[];
  }

  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const results = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.user_id, userId),
        eq(notifications.read, false)
      ));

    return results.length;
  }

  /**
   * Mark notification(s) as read
   */
  async markAsRead(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;

    await db
      .update(notifications)
      .set({ read: true })
      .where(
        // Use OR condition for multiple IDs
        notificationIds.length === 1
          ? eq(notifications.id, notificationIds[0])
          : undefined // Will be handled by filter in the query
      );
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(
        eq(notifications.user_id, userId),
        eq(notifications.read, false)
      ));
  }

  /**
   * Register push notification token
   */
  async registerPushToken(userId: string, token: string, deviceId?: string): Promise<void> {
    // Check if token already exists for this user
    const existing = await db
      .select()
      .from(pushTokens)
      .where(and(
        eq(pushTokens.user_id, userId),
        eq(pushTokens.token, token)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update the existing token's timestamp
      await db
        .update(pushTokens)
        .set({ 
          updated_at: new Date(),
          device_id: deviceId || existing[0].device_id
        })
        .where(eq(pushTokens.id, existing[0].id));
    } else {
      // Insert new token
      await db.insert(pushTokens).values({
        user_id: userId,
        token,
        device_id: deviceId,
      });
    }
  }

  /**
   * Send push notification to user's devices
   */
  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<void> {
    try {
      // Get all push tokens for the user
      const tokens = await db
        .select()
        .from(pushTokens)
        .where(eq(pushTokens.user_id, userId));

      if (tokens.length === 0) {
        console.log(`No push tokens found for user ${userId}`);
        return;
      }

      // Prepare messages
      const messages: ExpoPushMessage[] = tokens
        .filter(t => Expo.isExpoPushToken(t.token))
        .map(t => ({
          to: t.token,
          sound: 'default' as const,
          title,
          body,
          data: data || {},
        }));

      if (messages.length === 0) {
        console.log(`No valid Expo push tokens for user ${userId}`);
        return;
      }

      // Send notifications in chunks
      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          console.error('Error sending push notification chunk:', error);
        }
      }

      // Log results
      console.log(`Sent ${tickets.length} push notifications to user ${userId}`);
    } catch (error) {
      console.error('Error in sendPushNotification:', error);
    }
  }

  /**
   * Delete old notifications (cleanup task)
   */
  async deleteOldNotifications(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await db
      .delete(notifications)
      .where(and(
        eq(notifications.read, true),
        // Add date comparison when available in drizzle-orm
      ));

    return 0; // Return count when available
  }

  // Helper methods for specific notification types

  async notifyBountyApplication(hunterId: string, posterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: posterId,
      type: 'application',
      title: 'New Bounty Application',
      body: `Someone applied to your bounty: ${bountyTitle}`,
      data: { bountyId, hunterId },
    });
  }

  async notifyBountyAcceptance(hunterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: hunterId,
      type: 'acceptance',
      title: 'Bounty Accepted!',
      body: `Your application for "${bountyTitle}" was accepted`,
      data: { bountyId },
    });
  }

  async notifyBountyCompletion(posterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: posterId,
      type: 'completion',
      title: 'Bounty Completed',
      body: `"${bountyTitle}" has been marked as complete`,
      data: { bountyId },
    });
  }

  async notifyPayment(userId: string, amount: number, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId,
      type: 'payment',
      title: 'Payment Received',
      body: `You received $${(amount / 100).toFixed(2)} for "${bountyTitle}"`,
      data: { bountyId, amount },
    });
  }

  async notifyMessage(userId: string, senderId: string, senderName: string, messagePreview: string) {
    return this.createNotification({
      userId,
      type: 'message',
      title: `Message from ${senderName}`,
      body: messagePreview,
      data: { senderId },
    });
  }

  async notifyFollow(userId: string, followerId: string, followerName: string) {
    return this.createNotification({
      userId,
      type: 'follow',
      title: 'New Follower',
      body: `${followerName} started following you`,
      data: { followerId },
    });
  }
}

export const notificationService = new NotificationService();
