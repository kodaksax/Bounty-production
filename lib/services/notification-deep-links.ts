import type { Notification, NotificationCategory, NotificationType } from '../types';
import { categoryForNotificationType } from '../config/notification-taxonomy';
import { isBundled } from '../config/notification-taxonomy';

/**
 * Single source of truth for "where does tapping this notification go" and
 * "does tapping it open the rich-action sheet instead of navigating away".
 * Replaces the ad-hoc if/else chains that used to live independently in
 * lib/context/notification-context.tsx (handleNotificationTap) and
 * components/notifications-bell.tsx (handleNotificationPress).
 */

export type DeepLinkAction =
  | { kind: 'route'; path: string }
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'none' };

export interface NotificationDeepLinkContext {
  type: NotificationType | string;
  category?: NotificationCategory;
  data?: Notification['data'];
}

/**
 * Categories/types whose single (non-bundled) form supports a multi-action
 * rich sheet (Accept/Decline/Reply/Withdraw). Bundled notifications and every
 * other category fall back to plain navigation via resolveNotificationDeepLink.
 */
export function supportsActionSheet(ctx: NotificationDeepLinkContext, notification?: Pick<Notification, 'count'>): boolean {
  if (notification && isBundled(notification)) {
    // Bundled marketplace/messages notifications can't disambiguate which
    // applicant/conversation to act on — fall back to plain navigation.
    return false;
  }
  const category = ctx.category ?? categoryForNotificationType(ctx.type);
  return category === 'marketplace' || category === 'messages' || category === 'payments';
}

export function resolveNotificationDeepLink(ctx: NotificationDeepLinkContext): DeepLinkAction {
  const category = ctx.category ?? categoryForNotificationType(ctx.type);
  const data = ctx.data ?? {};

  switch (category) {
    case 'marketplace': {
      // Poster-facing quality nudges go to the poster's own bounty management
      // screen with the edit modal pre-opened, not the public bounty view —
      // the CTA is "Add details", not "View bounty".
      if (ctx.type === 'bounty_quality_nudge' && data.bountyId) {
        return { kind: 'route', path: `/postings/${data.bountyId}?openEdit=true` };
      }
      if (data.bountyId) return { kind: 'route', path: `/bounty/${data.bountyId}?source=notification` };
      return { kind: 'none' };
    }
    case 'messages': {
      if (data.conversationId) return { kind: 'conversation', conversationId: data.conversationId };
      return { kind: 'none' };
    }
    case 'payments': {
      if (ctx.type === 'payout_method_changed' || ctx.type === 'bank_disconnected') {
        return { kind: 'route', path: '/tabs/bounty-app?screen=wallet' };
      }
      if (data.bountyId) return { kind: 'route', path: `/bounty/${data.bountyId}?source=notification` };
      return { kind: 'route', path: '/tabs/bounty-app?screen=wallet' };
    }
    case 'security': {
      if (data.bountyId) return { kind: 'route', path: `/bounty/${data.bountyId}/dispute` };
      return { kind: 'none' };
    }
    case 'verification': {
      if (ctx.type === 'verification_verified') return { kind: 'route', path: '/verification/verified' };
      if (ctx.type === 'verification_rejected') return { kind: 'route', path: '/verification/rejected' };
      return { kind: 'route', path: '/verification/pending' };
    }
    case 'followers': {
      if (data.followerId) return { kind: 'route', path: `/profile/${data.followerId}` };
      return { kind: 'none' };
    }
    case 'marketing': {
      if (data.deepLinkPath) return { kind: 'route', path: data.deepLinkPath };
      return { kind: 'route', path: '/notifications' };
    }
    default:
      return { kind: 'none' };
  }
}
