import { eq } from 'drizzle-orm';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { db } from '../db/connection';
import { conversations, messages } from '../db/schema';
import { sendPushViaEdge } from './supabase-edge-client';

// Initialize Expo SDK
const expo = new Expo();

export type NotificationType = 'application' | 'acceptance' | 'rejection' | 'completion' | 'payment' | 'message' | 'follow' | 'cancellation' | 'stale_bounty' | 'stale_bounty_cancelled' | 'stale_bounty_reposted' | 'review_needed';

// ── Message debounce state ─────────────────────────────────────────────
// Key: `${recipientUserId}:${senderUserId}:${conversationId}`, Value: { timer, count, conversationId, latestText }
const MESSAGE_DEBOUNCE_MS = 5_000; // 5-second window to batch rapid messages from same sender
interface DebouncedMessage {
  timer: ReturnType<typeof setTimeout>;
  count: number;
  conversationId: string;
  latestText: string;
  senderHandle: string;
}
const messageDebounceMap = new Map<string, DebouncedMessage>();

// Map notification types to Android notification channel IDs
function getAndroidChannelId(type: NotificationType): string {
  switch (type) {
    case 'message': return 'messages';
    case 'application':
    case 'acceptance':
    case 'rejection':
    case 'completion':
    case 'cancellation':
    case 'review_needed':
    case 'stale_bounty':
    case 'stale_bounty_cancelled':
    case 'stale_bounty_reposted':
      return 'bounties';
    case 'payment': return 'payments';
    case 'follow':
    default: return 'default';
  }
}

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

interface NotificationPreferenceData {
  id?: string;
  user_id: string;
  applications_enabled: boolean;
  acceptances_enabled: boolean;
  completions_enabled: boolean;
  payments_enabled: boolean;
  messages_enabled: boolean;
  follows_enabled: boolean;
  reminders_enabled: boolean;
  system_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

interface SupabaseNotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any> | null;
  read: boolean;
  created_at: string;
}

interface SupabasePreferenceRow {
  id?: string;
  user_id?: string;
  applications_enabled?: boolean;
  acceptances_enabled?: boolean;
  completions_enabled?: boolean;
  payments_enabled?: boolean;
  messages_enabled?: boolean;
  follows_enabled?: boolean;
  reminders_enabled?: boolean;
  system_enabled?: boolean;
  applications?: boolean;
  acceptances?: boolean;
  completions?: boolean;
  payments?: boolean;
  messages?: boolean;
  in_app_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export class NotificationService {
  private supabaseClient: SupabaseClient<any> | null = null;
  private pushTokenOwnerColumn: 'user_id' | 'profile_id' | null = null;

  private getSupabaseClient(): SupabaseClient<any> {
    if (this.supabaseClient) return this.supabaseClient;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Supabase admin client is not configured for notifications');
    }

    this.supabaseClient = createClient<any>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    return this.supabaseClient;
  }

  private isMissingColumnError(error: PostgrestError | null, column: string): boolean {
    if (!error) return false;
    const message = `${error.message || ''} ${error.details || ''}`.toLowerCase();
    return message.includes('column') && message.includes(column.toLowerCase());
  }

  private mapNotificationRow(row: SupabaseNotificationRow): NotificationData {
    return {
      id: row.id,
      user_id: row.user_id,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      data: row.data ?? undefined,
      read: Boolean(row.read),
      created_at: row.created_at ? new Date(row.created_at) : new Date(),
    };
  }

  private mapPreferenceRow(userId: string, row: SupabasePreferenceRow): NotificationPreferenceData {
    return {
      id: row?.id,
      user_id: row?.user_id ?? userId,
      applications_enabled: row?.applications_enabled ?? row?.applications ?? true,
      acceptances_enabled: row?.acceptances_enabled ?? row?.acceptances ?? true,
      completions_enabled: row?.completions_enabled ?? row?.completions ?? true,
      payments_enabled: row?.payments_enabled ?? row?.payments ?? true,
      messages_enabled: row?.messages_enabled ?? row?.messages ?? true,
      follows_enabled: row?.follows_enabled ?? true,
      reminders_enabled: row?.reminders_enabled ?? true,
      system_enabled: row?.system_enabled ?? row?.in_app_enabled ?? true,
      created_at: row?.created_at,
      updated_at: row?.updated_at,
    };
  }

  private async resolvePushTokenOwnerColumn(): Promise<'user_id' | 'profile_id'> {
    if (this.pushTokenOwnerColumn) return this.pushTokenOwnerColumn;

    const supabase = this.getSupabaseClient();
    const attempts: Array<'user_id' | 'profile_id'> = ['user_id', 'profile_id'];
    let lastError: PostgrestError | null = null;

    for (const column of attempts) {
      const { error } = await supabase.from('push_tokens').select(column).limit(1);
      if (!error) {
        this.pushTokenOwnerColumn = column;
        return column;
      }
      if (!this.isMissingColumnError(error, column)) {
        throw error;
      }
      lastError = error;
    }

    throw lastError || new Error('Unable to determine push_tokens owner column');
  }

  /**
   * Check if user has enabled notifications for a specific type
   */
  private async isNotificationEnabled(userId: string, type: NotificationType): Promise<boolean> {
    try {
      const pref = await this.getPreferences(userId);
      
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

    const supabase = this.getSupabaseClient();
    const { data: inserted, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        body,
        data: data ?? null,
      })
      .select('*')
      .single();

    if (error || !inserted) {
      throw error || new Error('Failed to create notification');
    }

    // Send push notification if enabled and user preferences allow it
    if (sendPush && isEnabled) {
      // Include the notification type in the push data for Android channel routing
      const pushData = { ...data, notificationType: type };
      await this.sendPushNotification(userId, title, body, pushData);
    }

    return this.mapNotificationRow(inserted);
  }

  /**
   * Get notifications for a user
   */
  async getNotifications(userId: string, limit: number = 50, offset: number = 0): Promise<NotificationData[]> {
    if (limit <= 0) return [];
    const supabase = this.getSupabaseClient();
    const upper = offset + limit - 1;
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, upper);

    if (error) throw error;
    return (data || []).map((row) => this.mapNotificationRow(row));
  }

  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      const supabase = this.getSupabaseClient();
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;
      return count ?? 0;
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
    const supabase = this.getSupabaseClient();
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .in('id', notificationIds);
    if (error) throw error;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<void> {
    const supabase = this.getSupabaseClient();
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    if (error) throw error;
  }

  /**
   * Register push notification token
   */
  async registerPushToken(userId: string, token: string, deviceId?: string): Promise<void> {
    try {
      const profileExists = await this.ensureUserProfile(userId);
      if (!profileExists) {
        throw new Error(`Failed to ensure user profile exists for ${userId}`);
      }

      const supabase = this.getSupabaseClient();
      const ownerColumn = await this.resolvePushTokenOwnerColumn();

      const { error: deleteError } = await supabase
        .from('push_tokens')
        .delete()
        .eq('token', token)
        .neq(ownerColumn, userId);
      if (deleteError) throw deleteError;

      const { data: existing, error: existingError } = await supabase
        .from('push_tokens')
        .select('*')
        .eq(ownerColumn, userId)
        .eq('token', token)
        .limit(1);
      if (existingError) throw existingError;

      if (existing && existing.length > 0) {
        const { error: updateError } = await supabase
          .from('push_tokens')
          .update({
            updated_at: new Date().toISOString(),
            device_id: deviceId || existing[0].device_id || null,
          })
          .eq('id', existing[0].id);
        if (updateError) throw updateError;
        console.log(`✅ Updated push token for user ${userId}`);
        return;
      }

      type PushTokenInsertPayload =
        | { user_id: string; token: string; device_id: string | null; enabled?: boolean }
        | { profile_id: string; token: string; device_id: string | null; enabled?: boolean };
      const insertPayload: PushTokenInsertPayload = ownerColumn === 'user_id'
        ? { user_id: userId, token, device_id: deviceId ?? null, enabled: true }
        : { profile_id: userId, token, device_id: deviceId ?? null, enabled: true };
      let { error: insertError } = await supabase
        .from('push_tokens')
        .insert(insertPayload);
      if (this.isMissingColumnError(insertError, 'enabled')) {
        ({ error: insertError } = await supabase
          .from('push_tokens')
          .insert({
            [ownerColumn]: userId,
            token,
            device_id: deviceId ?? null,
          }));
      }
      if (insertError) throw insertError;
      console.log(`✅ Registered new push token for user ${userId}`);
    } catch (error) {
      // Log detailed error information for debugging
      console.error(`❌ Error registering push token for user ${userId}:`, error);
      
      const err = error as any;
      if (
        err?.code === '23503' ||
        err?.code === 'PGRST204' ||
        err?.constraint_name?.includes('user_id') ||
        (error instanceof Error && error.message.toLowerCase().includes('foreign key constraint'))
      ) {
        throw new Error(`User profile issue: Unable to register push token. Please contact support if this persists.`);
      }
      
      // Re-throw the error so the caller can handle it
      throw error;
    }
  }

  /**
   * Ensure user profile exists before operations that require FK references to profiles.id.
   */
  private async ensureUserProfile(userId: string): Promise<boolean> {
    try {
      const supabase = this.getSupabaseClient();
      const { data: existing, error: selectError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (selectError) throw selectError;
      if (existing?.id) return true;

      console.log(`📝 Creating minimal profile for user ${userId} (triggered by push token registration)`);
      const username = `user_${userId.replace(/-/g, '')}`;

      const candidateRows = [
        { id: userId, username },
        { id: userId, handle: username },
        { id: userId },
      ];

      for (const row of candidateRows) {
        const { error } = await supabase
          .from('profiles')
          .upsert(row, { onConflict: 'id' })
          .select('id')
          .single();
        if (!error) {
          console.log(`✅ Created minimal profile for user ${userId}`);
          return true;
        }
        if (error.code === '23505') return true;
        if (
          this.isMissingColumnError(error, 'username') ||
          this.isMissingColumnError(error, 'handle')
        ) {
          continue;
        }
      }

      return false;
    } catch (error) {
      const err = error as any;
      if (err?.code === '23505') return true;
      console.error(`❌ Error ensuring user profile exists for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Delete push notification token (called on logout to prevent cross-user notification leakage)
   */
  async deletePushToken(userId: string, token: string): Promise<void> {
    try {
      const supabase = this.getSupabaseClient();
      const ownerColumn = await this.resolvePushTokenOwnerColumn();
      const { error } = await supabase
        .from('push_tokens')
        .delete()
        .eq(ownerColumn, userId)
        .eq('token', token);
      if (error) throw error;
      console.log(`✅ Deleted push token for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error deleting push token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send push notification to user's devices.
   * Calculates the recipient's true unread count and includes it in the badge
   * field so the OS app-icon badge stays accurate even when the app is closed.
   * After sending, performs best-effort cleanup of tokens that the push
   * provider reports as invalid/expired (stale token lifecycle management).
   */
  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<void> {
    try {
      const supabase = this.getSupabaseClient();
      const ownerColumn = await this.resolvePushTokenOwnerColumn();

      // Get all push tokens for the user
      const initialTokensResult = await supabase
        .from('push_tokens')
        .select('id, token, enabled')
        .eq(ownerColumn, userId);
      let tokens = initialTokensResult.data as Array<{ id: string; token: string; enabled?: boolean }> | null;
      let tokensError = initialTokensResult.error as PostgrestError | null;
      if (this.isMissingColumnError(initialTokensResult.error, 'enabled')) {
        const fallbackTokensResult = await supabase
          .from('push_tokens')
          .select('id, token')
          .eq(ownerColumn, userId);
        tokens = fallbackTokensResult.data as Array<{ id: string; token: string; enabled?: boolean }> | null;
        tokensError = fallbackTokensResult.error as PostgrestError | null;
      }
      if (tokensError) throw tokensError;

      type PushTokenRecord = { id: string; token: string; enabled?: boolean };
      const activeTokens: PushTokenRecord[] = (tokens || []).filter((entry) => entry.enabled !== false);

      if (activeTokens.length === 0) {
        console.log(`No push tokens found for user ${userId}`);
        return;
      }

      // Calculate the true unread count for the badge
      let badge = 1;
      try {
        badge = await this.getUnreadCount(userId);
      } catch {
        // Non-fatal – default to 1 so the badge appears
      }

      // Determine the Android channel based on notification type
      const notificationType = (data?.notificationType ?? 'default') as NotificationType;
      const channelId = getAndroidChannelId(notificationType);

      // Filter to valid tokens and keep track of which token record each message corresponds to
      const validTokenEntries = activeTokens.filter((t) => Expo.isExpoPushToken(t.token));

      // Prepare messages
      const pushMessages: ExpoPushMessage[] = validTokenEntries
        .map(t => ({
          to: t.token,
          sound: 'default' as const,
          title,
          body,
          data: data || {},
          badge,
          channelId,
        }));

      if (pushMessages.length === 0) {
        console.log(`No valid Expo push tokens for user ${userId}`);
        return;
      }

      // If SUPABASE_EDGE_URL is configured, proxy the sends through the Supabase Edge Function
      const edgeUrl = process.env.SUPABASE_EDGE_URL
      if (edgeUrl) {
        try {
          const resp = await sendPushViaEdge(pushMessages.map(m => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: m.sound, badge: m.badge, channelId: m.channelId })));
          console.log(`Edge function push response for user ${userId}:`, resp);
          return; // Success – no need to fall through to expo-server-sdk
        } catch (err) {
          console.error('Error sending push via Supabase Edge Function, falling back to expo-server-sdk:', err);
          // Fall through to chunked Expo send below
        }
      }

      // Fallback: send notifications in chunks via expo-server-sdk
      const chunks = expo.chunkPushNotifications(pushMessages);
      const tickets: ExpoPushTicket[] = [];

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

      // ── Stale token cleanup (best-effort) ──────────────────────────
      // Tokens that return an "error" status with "DeviceNotRegistered" are stale
      // (e.g. user uninstalled the app). Remove them so future sends are efficient.
      // Use validTokenEntries (not the unfiltered tokens) so indices match tickets.
      this.cleanupStaleTokens(validTokenEntries, tickets).catch((err) => {
        console.error('Error during stale token cleanup:', err);
      });
    } catch (error) {
      console.error('Error in sendPushNotification:', error);
    }
  }

  /**
   * Remove push tokens that the Expo push service reported as invalid.
   * Called after each push send as best-effort cleanup.
   */
  private async cleanupStaleTokens(
    tokenRecords: { id: string; token: string }[],
    tickets: ExpoPushTicket[]
  ): Promise<void> {
    const staleTokenIds: string[] = [];

    for (let i = 0; i < tickets.length && i < tokenRecords.length; i++) {
      const ticket = tickets[i];
      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        staleTokenIds.push(tokenRecords[i].id);
        console.log(`🗑️  Marking stale push token with id ${tokenRecords[i].id} for cleanup`);
      }
    }

    if (staleTokenIds.length === 0) return;

    const supabase = this.getSupabaseClient();
    const { error } = await supabase
      .from('push_tokens')
      .delete()
      .in('id', staleTokenIds);
    if (error) throw error;
    console.log(`✅ Cleaned up ${staleTokenIds.length} stale push token(s)`);
  }

  /**
   * Delete old notifications (cleanup task)
   * Note: This is a placeholder for future implementation
   * when drizzle-orm adds support for date comparison in delete queries
   */
  async deleteOldNotifications(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const supabase = this.getSupabaseClient();
    const cutoffIso = cutoffDate.toISOString();
    const { data: oldNotifications, error: selectError } = await supabase
      .from('notifications')
      .select('id')
      .eq('read', true)
      .lt('created_at', cutoffIso)
      .limit(1000);
    if (selectError) throw selectError;

    const ids = (oldNotifications || []).map((row: any) => row.id);
    if (ids.length === 0) return 0;

    const { error: deleteError } = await supabase
      .from('notifications')
      .delete()
      .in('id', ids);
    if (deleteError) throw deleteError;

    return ids.length;
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

  /**
   * Send a message notification with debouncing.
   * If multiple messages arrive from the same sender to the same recipient within
   * MESSAGE_DEBOUNCE_MS, they are batched into a single summary notification
   * (e.g. "3 new messages from John") instead of individual pings.
   */
  async sendMessageNotification(userId: string, senderId: string, conversationId: string, messageText: string) {
    const debounceKey = `${userId}:${senderId}:${conversationId}`;
    const existing = messageDebounceMap.get(debounceKey);

    // Pre-fetch sender handle (needed for both immediate and batched sends)
    let senderHandle = 'Someone';
    try {
      const { users: usersTable } = await import('../db/schema');
      const senderInfo = await db
        .select({ handle: usersTable.handle })
        .from(usersTable)
        .where(eq(usersTable.id, senderId))
        .limit(1);
      senderHandle = senderInfo[0]?.handle || 'Someone';
    } catch {
      // Use fallback handle
    }

    if (existing) {
      // Another message arrived within the debounce window – accumulate
      clearTimeout(existing.timer);
      existing.count += 1;
      existing.latestText = messageText;
      existing.senderHandle = senderHandle;

      // Reset the timer to flush after the debounce window
      existing.timer = setTimeout(() => {
        this.flushDebouncedMessage(debounceKey).catch((err) => {
          console.error('Error flushing debounced message notification:', err);
        });
      }, MESSAGE_DEBOUNCE_MS);
      return;
    }

    // First message in the window – start the debounce timer
    const timer = setTimeout(() => {
      this.flushDebouncedMessage(debounceKey).catch((err) => {
        console.error('Error flushing debounced message notification:', err);
      });
    }, MESSAGE_DEBOUNCE_MS);

    messageDebounceMap.set(debounceKey, {
      timer,
      count: 1,
      conversationId,
      latestText: messageText,
      senderHandle,
    });
  }

  /**
   * Flush a debounced message notification – sends a single (possibly grouped) notification.
   */
  private async flushDebouncedMessage(debounceKey: string): Promise<void> {
    const entry = messageDebounceMap.get(debounceKey);
    if (!entry) return;
    messageDebounceMap.delete(debounceKey);

    const [userId, senderId] = debounceKey.split(':');
    const { count, conversationId, latestText, senderHandle } = entry;

    // Truncate message for preview
    const preview = latestText.length > 100
      ? latestText.substring(0, 100) + '...'
      : latestText;

    const title = count > 1
      ? `${count} new messages from ${senderHandle}`
      : `Message from ${senderHandle}`;
    const body = count > 1
      ? `Latest: ${preview}`
      : preview;

    await this.createNotification({
      userId,
      type: 'message',
      title,
      body,
      data: { senderId, conversationId, messageText: latestText, notificationType: 'message' },
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

  /** Notify a hunter that their Stripe payout was sent to their bank account. */
  async notifyPayoutPaid(hunterId: string, amount: number, payoutId: string) {
    return this.createNotification({
      userId: hunterId,
      type: 'payment',
      title: 'Payout Successful',
      body: `Your payout of $${amount.toFixed(2)} has been processed and sent to your bank account.`,
      data: { payoutId },
    });
  }

  /** Notify a hunter that their Stripe payout failed and include failure details. */
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
      const supabase = this.getSupabaseClient();
      const { data: existing, error: selectError } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) return this.mapPreferenceRow(userId, existing);

      const modernDefaults = {
        user_id: userId,
        applications_enabled: true,
        acceptances_enabled: true,
        completions_enabled: true,
        payments_enabled: true,
        messages_enabled: true,
        follows_enabled: true,
        reminders_enabled: true,
        system_enabled: true,
      };

      const { data: modernInserted, error: modernInsertError } = await supabase
        .from('notification_preferences')
        .insert(modernDefaults)
        .select('*')
        .single();

      if (!modernInsertError && modernInserted) {
        return this.mapPreferenceRow(userId, modernInserted);
      }

      if (!this.isMissingColumnError(modernInsertError, 'applications_enabled')) {
        throw modernInsertError;
      }

      const legacyDefaults = {
        user_id: userId,
        applications: true,
        acceptances: true,
        completions: true,
        payments: true,
        messages: true,
      };
      const { data: legacyInserted, error: legacyInsertError } = await supabase
        .from('notification_preferences')
        .insert(legacyDefaults)
        .select('*')
        .single();
      if (legacyInsertError || !legacyInserted) {
        throw legacyInsertError || new Error('Failed to create notification preferences');
      }

      return this.mapPreferenceRow(userId, legacyInserted);
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
      const supabase = this.getSupabaseClient();

      const modernPatch = {
        ...preferences,
        updated_at: new Date().toISOString(),
      };
      const { data: modernUpdated, error: modernUpdateError } = await supabase
        .from('notification_preferences')
        .update(modernPatch)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (!modernUpdateError && modernUpdated) {
        return this.mapPreferenceRow(userId, modernUpdated);
      }

      if (!this.isMissingColumnError(modernUpdateError, 'applications_enabled')) {
        throw modernUpdateError;
      }

      const legacyPatch = {
        ...(preferences.applications_enabled !== undefined ? { applications: preferences.applications_enabled } : {}),
        ...(preferences.acceptances_enabled !== undefined ? { acceptances: preferences.acceptances_enabled } : {}),
        ...(preferences.completions_enabled !== undefined ? { completions: preferences.completions_enabled } : {}),
        ...(preferences.payments_enabled !== undefined ? { payments: preferences.payments_enabled } : {}),
        ...(preferences.messages_enabled !== undefined ? { messages: preferences.messages_enabled } : {}),
        ...(preferences.system_enabled !== undefined ? { in_app_enabled: preferences.system_enabled } : {}),
        updated_at: new Date().toISOString(),
      };

      const { data: legacyUpdated, error: legacyUpdateError } = await supabase
        .from('notification_preferences')
        .update(legacyPatch)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (legacyUpdateError || !legacyUpdated) {
        throw legacyUpdateError || new Error('Failed to update notification preferences');
      }

      return this.mapPreferenceRow(userId, legacyUpdated);
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      throw error;
    }
  }
}

export const notificationService = new NotificationService();
