import type { Notification, NotificationCategory, NotificationType } from '../types';
import { categoryForNotificationType } from '../config/notification-taxonomy';
import { isBundled } from '../config/notification-taxonomy';
import { ROUTES } from '../routes';

/** Inbox → Requests tab, where a poster accepts or declines applications. */
export const POSTER_REQUESTS_PATH = `${ROUTES.TABS.BOUNTY_APP}?screen=messages&initialTab=requests`;

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

export function getNotificationBountyId(data?: Notification['data']): string | null {
  if (!data) return null;
  const bountyId = data.bountyId ?? data.bounty_id;
  return bountyId == null ? null : String(bountyId);
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
  // Accept both nearby-bounty payload keys.
  const bountyId = getNotificationBountyId(data);

  switch (category) {
    case 'marketplace': {
      // Poster-facing quality nudges go to the poster's own bounty management
      // screen with the edit modal pre-opened, not the public bounty view —
      // the CTA is "Add details", not "View bounty".
      if (ctx.type === 'bounty_quality_nudge' && bountyId) {
        return { kind: 'route', path: `/postings/${bountyId}?openEdit=true` };
      }
      // Poster-facing pending-application nudge: go straight to the
      // applicant management screen (where Accept/Decline live), not the
      // public bounty view -- same reasoning as the quality nudge above.
      if (ctx.type === 'application_pending_reminder' && bountyId) {
        return { kind: 'route', path: `/postings/${bountyId}` };
      }
      // Poster-facing "you never rated your hunter" nudge: go to the poster's
      // own bounty management screen, where my-posting-expandable.tsx's
      // review button re-opens PosterReviewModal straight onto the rating
      // step (it re-shows automatically for an approved, unrated submission).
      if (ctx.type === 'rating_reminder' && bountyId) {
        return { kind: 'route', path: `/postings/${bountyId}` };
      }
      // A new application is only ever sent to the poster, and the only thing
      // to do with it is accept/decline -- land on the Requests tab where that
      // happens (GitHub #809), even for bundled notifications with no bountyId.
      if (ctx.type === 'application') {
        return { kind: 'route', path: POSTER_REQUESTS_PATH };
      }
      if (bountyId) return { kind: 'route', path: `/bounty/${bountyId}?source=notification` };
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
      if (bountyId) return { kind: 'route', path: `/bounty/${bountyId}?source=notification` };
      return { kind: 'route', path: '/tabs/bounty-app?screen=wallet' };
    }
    case 'security': {
      if (bountyId) return { kind: 'route', path: `/bounty/${bountyId}/dispute` };
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
