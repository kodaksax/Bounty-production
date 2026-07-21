/**
 * Moments Queue — core types.
 *
 * A "moment" is a contextual activation prompt (identity verification,
 * enabling notifications, posting a first bounty, etc). This file defines
 * the shape of a moment definition (static, lives in registry.ts), its
 * persisted per-user state (stored in Supabase, user_activation_moments),
 * and the live app-state snapshot (MomentContext) eligibility is evaluated
 * against. See lib/moments/engine.ts for the evaluation logic and
 * lib/moments/registry.ts for the actual moment catalog.
 */

export type MomentType =
  // Trust / verification
  | 'identity_verification'
  | 'stripe_connect_onboarding'
  // Permissions
  | 'enable_notifications'
  | 'enable_location'
  // Profile completeness
  | 'add_profile_photo'
  | 'complete_profile'
  // Marketplace activation (event-triggered — see registry.ts doc comments)
  | 'post_first_bounty'
  | 'accept_first_bounty'
  | 'fund_wallet'
  | 'rate_completed_bounty'
  | 'bounty_completed_followup'
  | 'dispute_resolved_followup'
  // Retention / growth (event-triggered)
  | 'inactive_user_return'
  | 'large_payout_eligible'
  | 'invite_friends'
  | 'feature_announcement';

export type MomentStatus = 'pending' | 'shown' | 'dismissed' | 'completed' | 'expired' | 'snoozed';

/** Persisted per-user state for one moment type. One row per (user, moment_type) server-side. */
export interface MomentState {
  momentType: MomentType;
  status: MomentStatus;
  shownCount: number;
  firstShownAt: string | null;
  lastShownAt: string | null;
  dismissedAt: string | null;
  completedAt: string | null;
  snoozedUntil: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Live app-state snapshot moment eligibility is evaluated against. Built
 * cheaply from data callers already have loaded (profile, permissions) —
 * deliberately does NOT include on-demand queries (e.g. bounty counts), so
 * it's safe to rebuild on every foreground/focus. Event-specific facts
 * (e.g. "which bounty was just completed") travel via
 * momentsService.enqueue()'s metadata instead of living here.
 */
export interface MomentContext {
  userId: string;
  accountCreatedAt: string | null;
  /**
   * Number of distinct app sessions this device has recorded for this user
   * (see lib/moments/sessionTracking.ts) — a session boundary is the same
   * 30-minute-gap definition already used for profiles.last_session_at.
   * Lets a moment require "the user has come back at least once" before
   * ever showing, instead of firing the instant onboarding finishes.
   */
  sessionCount: number;
  /**
   * The bottom-nav screen key currently active in the tab shell (see
   * app/tabs/bounty-app.tsx's `activeScreen` state), or null if unknown
   * (e.g. context built outside the tab shell). Lets a moment prefer
   * showing while the user is on a relevant screen (e.g. Feed for
   * bounty-related prompts, Profile for the photo prompt) instead of
   * interrupting whatever else they're doing.
   */
  activeScreen: string | null;
  profile: {
    hasAvatar: boolean;
    hasBio: boolean;
    hasLocation: boolean;
    hasSkills: boolean;
    idVerificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected' | null;
    stripeConnectChargesEnabled: boolean;
    stripeConnectPayoutsEnabled: boolean;
    primaryRole: 'poster' | 'hunter' | 'both' | null;
    balance: number;
  };
  permissions: {
    notifications: 'granted' | 'denied' | 'undetermined';
    location: 'granted' | 'denied' | 'undetermined';
  };
}

export interface MomentContent {
  title: string;
  body: string;
  benefits?: string[];
  primaryLabel: string;
  /** Omit to make the moment programmatically dismissible only (no visible "later" affordance). */
  secondaryLabel?: string;
  estimatedMinutes?: number;
  /** MaterialIcons glyph name. */
  icon?: string;
}

export type MomentAction =
  | { type: 'navigate'; route: string }
  /** Resolved to a real handler by MomentsProvider's handler map (e.g. request a permission in place). */
  | { type: 'inline'; handlerKey: string };

export interface MomentDefinition {
  type: MomentType;
  /** Lower shows first. Ties broken by registry order. */
  priority: number;
  category: 'trust' | 'monetization' | 'profile' | 'engagement' | 'retention' | 'growth';
  /** Minimum hours before re-showing after a dismissal or snooze. */
  cooldownHours: number;
  /** Stop surfacing after this many shows even without an explicit dismissal. */
  maxShownCount?: number;
  /** Other moment types that must reach 'completed' before this one is eligible. */
  prerequisites?: MomentType[];
  /** If true, reaching 'completed' doesn't permanently retire the moment — a fresh enqueue() re-arms it (e.g. rate_completed_bounty fires once per completed bounty). */
  recurring?: boolean;
  isEligible: (ctx: MomentContext, state: MomentState | null) => boolean;
  /**
   * For state-derived moments only: has the underlying goal now been met
   * (e.g. avatar was added, verification was submitted)? Lets
   * MomentsProvider auto-complete a moment after the user navigates away
   * and finishes the target flow, without that screen needing to know
   * about the Moments Queue at all. Event-triggered moments are completed
   * explicitly by the code that enqueued them instead, so they omit this.
   */
  checkCompleted?: (ctx: MomentContext) => boolean;
  content: (ctx: MomentContext) => MomentContent;
  action: MomentAction;
}
