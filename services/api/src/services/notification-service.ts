import { and, desc, eq, ne } from 'drizzle-orm';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { db } from '../db/connection';
import { conversations, messages, notificationPreferences, notifications, pushTokens, users } from '../db/schema';
import { sendPushViaEdge } from './supabase-edge-client';

// Initialize Expo SDK
const expo = new Expo();

export type NotificationType = 'application' | 'acceptance' | 'rejection' | 'completion' | 'payment' | 'message' | 'follow' | 'cancellation' | 'stale_bounty' | 'stale_bounty_cancelled' | 'stale_bounty_reposted' | 'review_needed';

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
   * Check if user has enabled notifications for a specific type
   */
  private async isNotificationEnabled(userId: string, type: NotificationType): Promise<boolean> {
    try {
      const prefs = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.user_id, userId))
        .limit(1);

      if (prefs.length === 0) {
        // No preferences set, default to enabled
        return true;
      }

      const pref = prefs[0];
      
      // Map notification type to preference field
      switch (type) {
        case 'application':
          return pref.applications_enabled;
        case 'acceptance':
        case 'rejection':
          return pref.acceptances_enabled;
        case 'completion':
        case 'cancellation':
          return pref.completions_enabled;
        case 'review_needed':
          return pref.reminders_enabled || pref.completions_enabled;
        case 'payment':
          return pref.payments_enabled;
        case 'message':
          return pref.messages_enabled;
        case 'follow':
          return pref.follows_enabled;
        default:
          return true;
      }
    } catch (error) {
      console.error('Error checking notification preferences:', error);
      // Default to enabled on error
      return true;
    }
  }

  /**
   * Create a notification and optionally send push notification
   */
  async createNotification(params: CreateNotificationParams, sendPush: boolean = true): Promise<NotificationData> {
    const { userId, type, title, body, data } = params;

    // Check if user has enabled this notification type
    const isEnabled = await this.isNotificationEnabled(userId, type);
    
    if (!isEnabled) {
      console.log(`Notification type ${type} is disabled for user ${userId}`);
      // Return a mock notification object without creating it
      return {
        id: 'disabled',
        user_id: userId,
        type,
        title,
        body,
        data,
        read: true,
        created_at: new Date(),
      };
    }

    // Insert notification into database
    const [notification] = await db.insert(notifications).values({
      user_id: userId,
      type,
      title,
      body,
      data: data ? data : null,
    }).returning();

    // Send push notification if enabled and user preferences allow it
    if (sendPush && isEnabled) {
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
    try {
      const results = await db
        .select()
        .from(notifications)
        .where(and(
          eq(notifications.user_id, userId),
          eq(notifications.read, false)
        ));

      return results.length;
    } catch (error) {
      console.error(`Error getting unread count for user ${userId}:`, error);
      throw new Error(`Failed to get unread count: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Mark notification(s) as read
   */
  async markAsRead(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;

    const { inArray } = await import('drizzle-orm');
    
    await db
      .update(notifications)
      .set({ read: true })
      .where(inArray(notifications.id, notificationIds));
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
   * Ensure user profile exists before operations that require it
   * Creates a minimal profile if one doesn't exist
   * 
   * Note: This adds an extra SELECT query for all token registrations, but the performance
   * impact is minimal for this operation and ensures correctness. For existing users (the 
   * vast majority after initial rollout), this check will pass immediately.
   */
  private async ensureUserProfile(userId: string): Promise<boolean> {
    try {
      // Check if profile exists
      const existingProfile = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (existingProfile.length > 0) {
        return true;
      }

      // Profile doesn't exist - create a minimal one
      console.log(`📝 Creating minimal profile for user ${userId} (triggered by push token registration)`);
      
      // Generate a temporary username from user ID (use full UUID without hyphens to avoid collisions)
      // This is a temporary username that will be replaced during onboarding
      const username = `user_${userId.replace(/-/g, '')}`;
      
      await db.insert(users).values({
        id: userId,
        handle: username, // Using 'handle' (maps to 'username' column in DB)
      });
      
      console.log(`✅ Created minimal profile for user ${userId}`);
      return true;
    } catch (error) {
      // If error is due to duplicate key, profile was created concurrently - this is OK
      const err = error as any;
      if (err?.code === '23505') {
        console.log(`ℹ️  Profile for user ${userId} already exists (concurrent creation)`);
        return true;
      }
      
      console.error(`❌ Error ensuring user profile exists for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Register push notification token
   */
  async registerPushToken(userId: string, token: string, deviceId?: string): Promise<void> {
    try {
      // Ensure user profile exists before registering push token
      // This prevents foreign key constraint violations when tokens are registered
      // before the user profile is created during the signup flow
      const profileExists = await this.ensureUserProfile(userId);
      
      if (!profileExists) {
        throw new Error(`Failed to ensure user profile exists for ${userId}`);
      }

      // Atomically: remove this token from any other user and upsert for the current user.
      // Wrapping in a transaction prevents the race condition window between the delete and insert.
      await db.transaction(async (tx) => {
        // Remove token from any other user to prevent cross-user notification leakage
        // (e.g., device shared between accounts, or user re-installs app)
        await tx
          .delete(pushTokens)
          .where(and(
            eq(pushTokens.token, token),
            ne(pushTokens.user_id, userId)
          ));

        // Check if token already exists for this user
        const existing = await tx
          .select()
          .from(pushTokens)
          .where(and(
            eq(pushTokens.user_id, userId),
            eq(pushTokens.token, token)
          ))
          .limit(1);

        if (existing.length > 0) {
          // Update the existing token's timestamp
          await tx
            .update(pushTokens)
            .set({ 
              updated_at: new Date(),
              device_id: deviceId || existing[0].device_id
            })
            .where(eq(pushTokens.id, existing[0].id));
          console.log(`✅ Updated push token for user ${userId}`);
        } else {
          // Insert new token
          await tx.insert(pushTokens).values({
            user_id: userId,
            token,
            device_id: deviceId,
          });
          console.log(`✅ Registered new push token for user ${userId}`);
        }
      });
    } catch (error) {
      // Log detailed error information for debugging
      console.error(`❌ Error registering push token for user ${userId}:`, error);
      
      // Check if it's a foreign key constraint error
      // Drizzle ORM and Postgres errors contain specific codes and constraint names
      // Note: This should be unreachable now with ensureUserProfile(), but kept as a defensive
      // safeguard in case the profile is deleted between the check and insert (race condition)
      const err = error as any;
      if (err?.code === '23503' || // Postgres FK violation code
          err?.constraint_name?.includes('user_id') ||
          (error instanceof Error && error.message.includes('foreign key constraint'))) {
        throw new Error(`User profile issue: Unable to register push token. Please contact support if this persists.`);
      }
      
      // Re-throw the error so the caller can handle it
      throw error;
    }
  }

  /**
   * Delete push notification token (called on logout to prevent cross-user notification leakage)
   */
  async deletePushToken(userId: string, token: string): Promise<void> {
    try {
      await db
        .delete(pushTokens)
        .where(and(
          eq(pushTokens.user_id, userId),
          eq(pushTokens.token, token)
        ));
      console.log(`✅ Deleted push token for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error deleting push token for user ${userId}:`, error);
      throw error;
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

      // If SUPABASE_EDGE_URL is configured, proxy the sends through the Supabase Edge Function
      const edgeUrl = process.env.SUPABASE_EDGE_URL
      if (edgeUrl) {
        try {
          const resp = await sendPushViaEdge(messages.map(m => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: m.sound })));
          console.log(`Edge function push response for user ${userId}:`, resp);
        } catch (err) {
          console.error('Error sending push via Supabase Edge Function:', err);
        }
        return;
      }

      // Fallback: send notifications in chunks via expo-server-sdk
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
   * Note: This is a placeholder for future implementation
   * when drizzle-orm adds support for date comparison in delete queries
   */
  async deleteOldNotifications(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // TODO: Implement when drizzle-orm supports lt/lte in delete operations
    // For now, use a raw SQL query or select + delete approach
    const oldNotifications = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.read, true),
        // Manual date comparison
      ))
      .limit(1000); // Limit to prevent performance issues

    if (oldNotifications.length === 0) return 0;

    const { inArray } = await import('drizzle-orm');
    await db
      .delete(notifications)
      .where(inArray(notifications.id, oldNotifications.map(n => n.id)));

    return oldNotifications.length;
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
    const notif = await this.createNotification({
      userId: hunterId,
      type: 'acceptance',
      title: 'Bounty Accepted!',
      body: `Your application for "${bountyTitle}" was accepted`,
      data: { bountyId },
    });

    // Try to also insert a short in-thread message in the bounty conversation (best-effort)
    try {
      const conv = await db.select().from(conversations).where(eq(conversations.bounty_id, bountyId)).limit(1);
      if (conv.length > 0) {
        const conversationId = conv[0].id;
        const text = `Your application for "${bountyTitle}" was accepted.`;
        await db.insert(messages).values({ conversation_id: conversationId, sender_id: hunterId, text }).returning();
      }
    } catch (err) {
      console.error('Failed to insert acceptance message into conversation:', err);
    }

    return notif;
  }

  async notifyBountyRejection(hunterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: hunterId,
      type: 'rejection',
      title: 'Application Not Selected',
      body: `Your application for "${bountyTitle}" was not selected`,
      data: { bountyId },
    });
  }

  async notifyBountyCancellation(hunterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: hunterId,
      type: 'cancellation',
      title: 'Bounty Cancelled',
      body: `The bounty "${bountyTitle}" has been cancelled`,
      data: { bountyId },
    });
  }

  async notifyBountyCompletion(posterId: string, bountyId: string, bountyTitle: string, completedBy?: string) {
    const notif = await this.createNotification({
      userId: posterId,
      type: 'completion',
      title: 'Bounty Completed',
      body: `"${bountyTitle}" has been marked as complete`,
      data: { bountyId },
    });

    // Also try to create an in-conversation completion message
    try {
      const conv = await db.select().from(conversations).where(eq(conversations.bounty_id, bountyId)).limit(1);
      if (conv.length > 0) {
        const conversationId = conv[0].id;
        const senderId = completedBy || posterId;
        const text = `Work marked as complete for "${bountyTitle}".`;
        await db.insert(messages).values({ conversation_id: conversationId, sender_id: senderId, text }).returning();
      }
    } catch (err) {
      console.error('Failed to insert completion message into conversation:', err);
    }

    return notif;
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

  async sendMessageNotification(userId: string, senderId: string, conversationId: string, messageText: string) {
    // Get sender info
    const { users } = await import('../db/schema');
    const senderInfo = await db
      .select({ handle: users.handle })
      .from(users)
      .where(eq(users.id, senderId))
      .limit(1);

    const senderHandle = senderInfo[0]?.handle || 'Someone';
    
    // Truncate message for preview
    const preview = messageText.length > 100 
      ? messageText.substring(0, 100) + '...'
      : messageText;

    return this.createNotification({
      userId,
      type: 'message',
      title: `Message from ${senderHandle}`,
      body: preview,
      data: { senderId, conversationId, messageText },
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

  async notifyRevisionRequest(hunterId: string, bountyId: string, bountyTitle: string, feedback: string) {
    return this.createNotification({
      userId: hunterId,
      type: 'completion',
      title: 'Revision Requested',
      body: `The poster requested changes to "${bountyTitle}". Check the feedback and resubmit.`,
      data: { bountyId, feedback, isRevision: true },
    });
  }

  async notifyBountyReadyForReview(posterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: posterId,
      type: 'review_needed',
      title: 'Review Needed',
      body: `A hunter has marked "${bountyTitle}" as ready for review.`,
      data: { bountyId },
    });
  }

  async notifyBountyApproved(hunterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: hunterId,
      type: 'completion',
      title: 'Work Approved! 🎉',
      body: `Excellent work! Your submission for "${bountyTitle}" has been approved.`,
      data: { bountyId },
    });
  }

  async notifyBountyStale(posterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: posterId,
      type: 'stale_bounty',
      title: 'Action Required: Bounty Needs Attention',
      body: `The hunter for "${bountyTitle}" has deleted their account. Please review and take action.`,
      data: { bountyId, isStale: true },
    });
  }

  async notifyStaleBountyCancelled(posterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: posterId,
      type: 'stale_bounty_cancelled',
      title: 'Bounty Cancelled',
      body: `"${bountyTitle}" has been cancelled and your funds will be refunded.`,
      data: { bountyId, isCancelled: true },
    });
  }

  async notifyStaleBountyReposted(posterId: string, bountyId: string, bountyTitle: string) {
    return this.createNotification({
      userId: posterId,
      type: 'stale_bounty_reposted',
      title: 'Bounty Reposted',
      body: `"${bountyTitle}" has been reposted and is now open for new hunters.`,
      data: { bountyId, isReposted: true },
    });
  }

  async notifyPayoutPaid(hunterId: string, amount: number, payoutId: string) {
    return this.createNotification({
      userId: hunterId,
      type: 'payment',
      title: 'Payout Successful',
      body: `Your payout of $${amount.toFixed(2)} has been processed and sent to your bank account.`,
      data: { payoutId },
    });
  }

  async notifyPayoutFailed(
    hunterId: string,
    amount: number,
    payoutId: string,
    failureCode: string | null,
    failureMessage: string | null,
  ) {
    return this.createNotification({
      userId: hunterId,
      type: 'payment',
      title: 'Payout Failed',
      body: `Your payout of $${amount.toFixed(2)} could not be processed. ${failureMessage || failureCode || 'Please update your bank account details.'}`,
      data: { payoutId, failureCode, failureMessage },
    });
  }

  // Notification Preferences Management

  /**
   * Get notification preferences for a user
   */
  async getPreferences(userId: string) {
    try {
      const prefs = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.user_id, userId))
        .limit(1);

      if (prefs.length === 0) {
        // Create default preferences if they don't exist
        const [newPrefs] = await db
          .insert(notificationPreferences)
          .values({
            user_id: userId,
          })
          .returning();
        return newPrefs;
      }

      return prefs[0];
    } catch (error) {
      console.error('Error getting notification preferences:', error);
      throw error;
    }
  }

  /**
   * Update notification preferences for a user
   */
  async updatePreferences(
    userId: string,
    preferences: {
      applications_enabled?: boolean;
      acceptances_enabled?: boolean;
      completions_enabled?: boolean;
      payments_enabled?: boolean;
      messages_enabled?: boolean;
      follows_enabled?: boolean;
      reminders_enabled?: boolean;
      system_enabled?: boolean;
    }
  ) {
    try {
      // Ensure preferences exist first
      await this.getPreferences(userId);

      // Update preferences
      const [updated] = await db
        .update(notificationPreferences)
        .set({
          ...preferences,
          updated_at: new Date(),
        })
        .where(eq(notificationPreferences.user_id, userId))
        .returning();

      return updated;
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      throw error;
    }
  }
}

export const notificationService = new NotificationService();
