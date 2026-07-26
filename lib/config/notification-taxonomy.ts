import type { Notification, NotificationCategory, NotificationType } from '../types';

/**
 * Notification category taxonomy — single client-side source of truth for
 * type -> category mapping and quiet-hours urgency rules.
 *
 * Mirrored by hand in supabase/functions/process-notification/index.ts
 * (TYPE_CATEGORY / URGENT_TYPES) since Deno's edge function bundler doesn't
 * support importing from lib/. Keep both in sync when adding a new type.
 */
export const NOTIFICATION_TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  application: 'marketplace',
  acceptance: 'marketplace',
  completion: 'marketplace',
  cancellation_request: 'marketplace',
  cancellation_accepted: 'marketplace',
  cancellation_rejected: 'marketplace',
  stale_bounty: 'marketplace',
  stale_bounty_cancelled: 'marketplace',
  stale_bounty_reposted: 'marketplace',
  update: 'marketplace',
  bounty_nearby: 'marketplace',
  bounty_expiry: 'marketplace',
  review_needed: 'marketplace',

  message: 'messages',

  payment: 'payments',
  payout_paid: 'payments',
  payout_failed: 'payments',
  payout_canceled: 'payments',
  withdrawal_reversed: 'payments',
  bank_disconnected: 'payments',
  payout_method_changed: 'payments',
  balance_update: 'payments',

  dispute_created: 'security',
  dispute_resolved: 'security',
  workflow_dispute_created: 'security',
  dispute_escalated: 'security',
  account_warning: 'security',
  account_restricted: 'security',

  verification_submitted: 'verification',
  verification_verified: 'verification',
  verification_rejected: 'verification',
  verification_canceled: 'verification',

  follow: 'followers',

  marketing_promo: 'marketing',
};

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'marketplace', 'messages', 'payments', 'security', 'verification', 'followers', 'marketing',
];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  marketplace: 'Marketplace',
  messages: 'Messages',
  payments: 'Payments',
  security: 'Security',
  verification: 'Verification',
  followers: 'Followers',
  marketing: 'Marketing',
};

export function categoryForNotificationType(type: NotificationType | string): NotificationCategory {
  return (NOTIFICATION_TYPE_CATEGORY as Record<string, NotificationCategory>)[type] ?? 'marketplace';
}

/**
 * Types that bypass quiet hours. Every `security`-category type is always
 * urgent even if not individually listed here (see isUrgentNotification).
 */
const URGENT_TYPES = new Set<NotificationType>([
  'dispute_created', 'dispute_resolved', 'workflow_dispute_created', 'dispute_escalated',
  'account_warning', 'account_restricted',
  'payout_failed', 'payout_canceled', 'withdrawal_reversed', 'bank_disconnected',
  'verification_rejected',
]);

export function isUrgentNotification(type: NotificationType | string): boolean {
  return categoryForNotificationType(type) === 'security' || URGENT_TYPES.has(type as NotificationType);
}

/** Categories where push + in-app delivery cannot be disabled by the user. */
export function isForcedChannel(category: NotificationCategory, channel: 'push' | 'email' | 'in_app' | 'sms'): boolean {
  return (category === 'security' || category === 'verification') && (channel === 'push' || channel === 'in_app');
}

/** Whether a bundled notification (count > 1) still supports its category's rich actions. */
export function isBundled(notification: Pick<Notification, 'count'>): boolean {
  return (notification.count ?? 1) > 1;
}
