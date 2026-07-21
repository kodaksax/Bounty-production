/**
 * Moments Queue — registry.
 *
 * The single, centralized catalog of every activation moment: its
 * priority, eligibility rule, cooldown, prerequisites, and copy. Screens
 * and other subsystems never decide "should I show a prompt right now" —
 * they either (a) let MomentsProvider evaluate state-derived eligibility
 * automatically, or (b) call momentsService.enqueue() at a specific event
 * (see the per-moment doc comments below for which ones expect that and
 * where the call site should live). This is what "centralize moment
 * evaluation" means in practice: adding a new moment is adding one entry
 * here, never scattering an `if` into an unrelated screen.
 *
 * Three groups:
 *  - STATE-DERIVED moments (identity_verification, stripe_connect_onboarding,
 *    enable_notifications, enable_location, complete_profile): eligibility
 *    is a pure function of MomentContext (profile + permission snapshot)
 *    and needs no explicit trigger — it's re-evaluated every time
 *    MomentsProvider refreshes.
 *  - SESSION/SCREEN-GATED moments (add_profile_photo, post_first_bounty,
 *    accept_first_bounty): also state-derived (or enqueue-derived — see
 *    below), but additionally require `ctx.sessionCount` to clear a
 *    per-moment threshold and/or `ctx.activeScreen` to be a relevant tab
 *    before they're eligible. This is what keeps engagement prompts out of
 *    the immediate post-onboarding moment: a brand-new user's first
 *    MomentsProvider evaluation is always sessionCount === 1, so nothing in
 *    this group can appear until the user has come back for a later
 *    session (or, for the photo prompt, actually opened Profile). See each
 *    moment's own comment for its specific rule and reasoning.
 *  - EVENT-TRIGGERED moments (fund_wallet, rate_completed_bounty,
 *    bounty_completed_followup, dispute_resolved_followup,
 *    inactive_user_return, large_payout_eligible, invite_friends,
 *    feature_announcement): only become eligible once another part of the
 *    app calls `momentsService.enqueue(userId, momentType, metadata)` at
 *    the moment the underlying event happens (e.g. a bounty is accepted).
 *    They are fully defined and ready to show — wiring the `enqueue()`
 *    call at each event's real call site (bounty acceptance, bounty
 *    completion, dispute resolution, etc.) is listed as follow-up work,
 *    since those call sites live in unrelated parts of the app outside
 *    this change's scope.
 */

import { referralService } from './referral-service';
import type { MomentContext, MomentDefinition, MomentState } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function accountAgeDays(ctx: MomentContext): number {
  if (!ctx.accountCreatedAt) return 0;
  return (Date.now() - new Date(ctx.accountCreatedAt).getTime()) / DAY_MS;
}

/** Event-triggered moments share this eligibility rule: only show once explicitly enqueued and not yet resolved. */
function eligibleWhenEnqueued(_ctx: MomentContext, state: MomentState | null): boolean {
  return state?.status === 'pending' && Object.keys(state.metadata ?? {}).length >= 0;
}

/**
 * Bottom-nav screens where a "post a bounty" / "browse bounties" nudge is
 * contextually relevant (Feed = 'bounty', Activity/Requests = 'postings').
 * See app/tabs/bounty-app.tsx's ScreenKey for the full set of screen keys —
 * 'wallet'/'profile'/'messages'/'admin' are deliberately excluded so these
 * prompts never interrupt an unrelated task.
 */
const BOUNTY_RELEVANT_SCREENS = new Set(['bounty', 'postings']);

/** A brand-new user's very first MomentsProvider evaluation is always sessionCount === 1 (see MomentContext doc comment). Requiring >= 2 guarantees nothing in this file can fire in that first sitting. */
const MIN_SESSIONS_FOR_ACTIVATION_PROMPT = 2;
/** Profile-photo prompt is lower urgency, so it waits for a couple of return visits before nagging on its own — unless the user is already on the Profile screen, in which case it's not an interruption. */
const MIN_SESSIONS_FOR_PROFILE_PHOTO = 3;

/**
 * Screens where trust/payout prompts (identity verification, Connect setup)
 * are directly relevant to what the user is doing right now — a "strong
 * reason" to offer them even to a brand-new user in their very first
 * session, per the same principle MIN_SESSIONS_FOR_ACTIVATION_PROMPT exists
 * to protect against for passive, out-of-context nudging.
 */
const WALLET_RELEVANT_SCREENS = new Set(['wallet']);
/**
 * Balance (in dollars — profiles.balance is NUMERIC, not cents) above which
 * an unverified account is enough of a trust/safety concern that verifying
 * is worth surfacing regardless of session count. Mirrors the $100 "high-
 * value account" threshold hooks/use-two-factor-auth.ts already uses to
 * prompt 2FA enrollment, applied here in dollars since MomentContext's
 * balance field isn't in cents.
 */
const HIGH_VALUE_BALANCE_THRESHOLD = 100;

export const MOMENT_REGISTRY: MomentDefinition[] = [
  // ---------------------------------------------------------------------
  // STATE-DERIVED — fully wired
  // ---------------------------------------------------------------------
  {
    type: 'enable_notifications',
    priority: 10,
    category: 'engagement',
    cooldownHours: 72,
    maxShownCount: 3,
    isEligible: (ctx) => ctx.permissions.notifications === 'undetermined',
    checkCompleted: (ctx) => ctx.permissions.notifications !== 'undetermined',
    content: () => ({
      icon: 'notifications-none',
      title: 'Know the moment money is nearby',
      body: "We'll only ping you for things that matter: a new bounty near you, an offer on your post, or a payout landing.",
      benefits: ['Hear about nearby bounties first', 'Never miss a message or offer', 'Off anytime in Settings'],
      primaryLabel: 'Turn on notifications',
      secondaryLabel: 'Not now',
    }),
    action: { type: 'inline', handlerKey: 'request_notifications' },
  },
  {
    type: 'add_profile_photo',
    priority: 20,
    category: 'profile',
    cooldownHours: 96,
    maxShownCount: 2,
    // Never right after onboarding: either the user has been back for a
    // few sessions (MIN_SESSIONS_FOR_PROFILE_PHOTO), or they're already on
    // the Profile screen, which is the one place this prompt isn't an
    // interruption — it's exactly what they're there to do.
    isEligible: (ctx) =>
      !ctx.profile.hasAvatar &&
      (ctx.sessionCount >= MIN_SESSIONS_FOR_PROFILE_PHOTO || ctx.activeScreen === 'profile'),
    checkCompleted: (ctx) => ctx.profile.hasAvatar,
    content: () => ({
      icon: 'add-a-photo',
      title: 'Add a profile photo',
      body: 'Profiles with a photo get matched and hired faster — it helps other users know exactly who they’re working with.',
      benefits: ['Faster responses on posts and offers', 'Higher trust with hunters and posters'],
      primaryLabel: 'Add photo',
      secondaryLabel: 'Maybe later',
      estimatedMinutes: 1,
    }),
    action: { type: 'navigate', route: '/profile/edit' },
  },
  {
    type: 'complete_profile',
    priority: 30,
    category: 'profile',
    cooldownHours: 96,
    maxShownCount: 2,
    isEligible: (ctx) => accountAgeDays(ctx) >= 1 && (!ctx.profile.hasBio || !ctx.profile.hasLocation),
    checkCompleted: (ctx) => ctx.profile.hasBio && ctx.profile.hasLocation,
    content: () => ({
      icon: 'person-outline',
      title: 'Finish setting up your profile',
      body: 'A bio and location help us match you with the right bounties nearby, and help others trust who they’re dealing with.',
      benefits: ['Better bounty matching', 'Shows up in local search'],
      primaryLabel: 'Complete profile',
      secondaryLabel: 'Maybe later',
      estimatedMinutes: 2,
    }),
    action: { type: 'navigate', route: '/profile/edit' },
  },
  {
    type: 'enable_location',
    priority: 40,
    category: 'engagement',
    cooldownHours: 72,
    maxShownCount: 3,
    isEligible: (ctx) => ctx.permissions.location === 'undetermined',
    checkCompleted: (ctx) => ctx.permissions.location !== 'undetermined',
    content: () => ({
      icon: 'location-on',
      title: 'See what’s actually near you',
      body: 'Turn on location to see real distances to nearby bounties instead of browsing everything citywide.',
      benefits: ['Real distances, not guesses', 'Only your area is stored — never your exact address'],
      primaryLabel: 'Use my location',
      secondaryLabel: 'Not now',
    }),
    action: { type: 'inline', handlerKey: 'request_location' },
  },
  {
    type: 'identity_verification',
    priority: 50,
    category: 'trust',
    cooldownHours: 96,
    maxShownCount: 3,
    // Never right after onboarding, unless there's a strong reason: the
    // user is somewhere verification actually unlocks something right now
    // (wallet/payouts — VERIFICATION_RELEVANT_SCREENS), or their balance has
    // grown enough that verifying is a real trust/safety concern rather
    // than a nice-to-have (HIGH_VALUE_BALANCE_THRESHOLD). Either of those is
    // shown to a brand-new user in their very first session. Absent a
    // strong reason, this waits for a later session like every other
    // passive activation prompt (MIN_SESSIONS_FOR_ACTIVATION_PROMPT).
    // 'rejected' is included alongside 'unverified'/null so a resubmission
    // nudge follows the same cooldown/suppression rules instead of nagging
    // unboundedly — matching the resubmit entry point already on the
    // profile screen.
    isEligible: (ctx) => {
      const needsVerification =
        ctx.profile.idVerificationStatus === 'unverified' ||
        ctx.profile.idVerificationStatus === null ||
        ctx.profile.idVerificationStatus === 'rejected';
      if (!needsVerification) return false;

      const hasStrongReason =
        (ctx.activeScreen != null && WALLET_RELEVANT_SCREENS.has(ctx.activeScreen)) ||
        ctx.profile.balance >= HIGH_VALUE_BALANCE_THRESHOLD;
      if (hasStrongReason) return true;

      return ctx.sessionCount >= MIN_SESSIONS_FOR_ACTIVATION_PROMPT;
    },
    checkCompleted: (ctx) => ctx.profile.idVerificationStatus === 'pending' || ctx.profile.idVerificationStatus === 'verified',
    content: (ctx) =>
      ctx.profile.idVerificationStatus === 'rejected'
        ? {
            icon: 'verified-user',
            title: 'Resubmit your ID verification',
            body: 'Your last submission wasn’t approved. Try again with a clear, well-lit photo — it takes about 2 minutes.',
            primaryLabel: 'Resubmit now',
            secondaryLabel: 'Later',
            estimatedMinutes: 2,
          }
        : {
            icon: 'verified-user',
            title: 'Verify your identity',
            body: 'A quick ID check builds trust with other users and unlocks higher limits. It takes about 2 minutes, and you can always do it later from your profile.',
            benefits: [
              'Verified badge on your profile',
              'Higher transaction limits',
              'Priority in bounty matching',
              'Enhanced trust score',
            ],
            primaryLabel: 'Verify now',
            secondaryLabel: 'Later',
            estimatedMinutes: 2,
          },
    action: { type: 'navigate', route: '/verification/upload-id' },
  },
  {
    type: 'stripe_connect_onboarding',
    priority: 60,
    category: 'monetization',
    cooldownHours: 48,
    maxShownCount: 5,
    // Deliberately narrow: only users who identified as hunters (or both) —
    // and therefore actually stand to receive payouts — ever see this.
    // Posters would never benefit, so showing it to them would be exactly
    // the "presenting before it's relevant" the spec warns against.
    //
    // Same "strong reason" pattern as identity_verification: never right
    // after onboarding by default — either the user is somewhere payouts
    // are actually relevant right now (the wallet screen, where "receive
    // earnings"/"withdraw" live — WALLET_RELEVANT_SCREENS), or they've come
    // back for a later session. This is what keeps it from firing on the
    // very first render after signup and from feeling like a random
    // interruption on an unrelated screen.
    isEligible: (ctx) => {
      const isPayoutEligibleRole = ctx.profile.primaryRole === 'hunter' || ctx.profile.primaryRole === 'both';
      if (!isPayoutEligibleRole || ctx.profile.stripeConnectPayoutsEnabled) return false;

      const hasStrongReason = ctx.activeScreen != null && WALLET_RELEVANT_SCREENS.has(ctx.activeScreen);
      if (hasStrongReason) return true;

      return ctx.sessionCount >= MIN_SESSIONS_FOR_ACTIVATION_PROMPT;
    },
    checkCompleted: (ctx) => ctx.profile.stripeConnectPayoutsEnabled,
    content: () => ({
      icon: 'account-balance',
      title: 'Set up payouts',
      body: 'Connect a bank account so you can get paid the moment a bounty you complete is approved. Setup takes about 5 minutes through Stripe, our payments partner.',
      benefits: [
        'Get paid directly to your bank',
        'No manual withdrawal requests',
        'Bank-level security via Stripe',
      ],
      primaryLabel: 'Set up payouts',
      secondaryLabel: "I'll do this later",
      estimatedMinutes: 5,
    }),
    action: { type: 'navigate', route: '/wallet/connect/embedded-onboarding' },
  },

  // ---------------------------------------------------------------------
  // SESSION/SCREEN-GATED — enqueue-derived, but only actually surface after
  // a later session + relevant screen (see class-level doc comment above).
  // add_profile_photo (above, in the state-derived block) belongs to this
  // group too; it's ordered there because its enqueue mechanism differs
  // (purely state-derived, no momentsService.enqueue() call at all).
  // ---------------------------------------------------------------------
  {
    type: 'post_first_bounty',
    priority: 5,
    category: 'engagement',
    cooldownHours: 24,
    maxShownCount: 3,
    // Enqueued (status: 'pending') from lib/moments/backfill.ts, which runs
    // once per session and marks this completed outright if the user
    // already has a bounty — see that file for the query. Enqueuing does
    // NOT make this visible by itself: it only becomes eligible once the
    // user has been back for a second session AND is on a screen where
    // posting is contextually relevant (Feed or Activity/Requests), so it
    // never fires as part of the immediate post-onboarding transition.
    isEligible: (ctx, state) =>
      eligibleWhenEnqueued(ctx, state) &&
      ctx.sessionCount >= MIN_SESSIONS_FOR_ACTIVATION_PROMPT &&
      (ctx.activeScreen == null || BOUNTY_RELEVANT_SCREENS.has(ctx.activeScreen)),
    content: () => ({
      icon: 'add-circle-outline',
      title: 'Ready to get something done?',
      body: 'Post your first bounty — describe the task, set a price, and we handle the rest.',
      primaryLabel: 'Post a bounty',
      secondaryLabel: 'Not right now',
    }),
    action: { type: 'navigate', route: '/tabs/postings-screen' },
  },
  {
    type: 'accept_first_bounty',
    priority: 8,
    category: 'engagement',
    cooldownHours: 24,
    maxShownCount: 3,
    // Enqueued from lib/moments/backfill.ts (see post_first_bounty comment
    // above for the general mechanism). Gated to the Feed screen
    // specifically ("browsing available bounties"), not Activity, since
    // that's the actual browse surface for a hunter.
    isEligible: (ctx, state) =>
      eligibleWhenEnqueued(ctx, state) &&
      ctx.sessionCount >= MIN_SESSIONS_FOR_ACTIVATION_PROMPT &&
      (ctx.activeScreen == null || ctx.activeScreen === 'bounty'),
    content: () => ({
      icon: 'explore',
      title: 'Your first bounty is waiting',
      body: 'Browse bounties near you and accept one to start earning.',
      primaryLabel: 'Browse bounties',
      secondaryLabel: 'Not right now',
    }),
    action: { type: 'navigate', route: '/tabs/bounty-app' },
  },
  // ---------------------------------------------------------------------
  // EVENT-TRIGGERED — defined and ready; enqueue() call sites are backlog
  // (see class-level doc comment above for where each belongs)
  // ---------------------------------------------------------------------
  {
    type: 'fund_wallet',
    priority: 15,
    category: 'monetization',
    cooldownHours: 48,
    maxShownCount: 3,
    // Enqueue from: bounty composer flows, when a poster's draft bounty
    // price exceeds their current wallet balance.
    isEligible: eligibleWhenEnqueued,
    content: () => ({
      icon: 'account-balance-wallet',
      title: 'Add funds to post this bounty',
      body: 'Your bounty is held safely in escrow until the job is approved — add funds to post it now.',
      primaryLabel: 'Add funds',
      secondaryLabel: 'Not now',
    }),
    action: { type: 'navigate', route: '/tabs/wallet-screen' },
  },
  {
    type: 'rate_completed_bounty',
    priority: 25,
    category: 'engagement',
    cooldownHours: 12,
    recurring: true,
    // Enqueue from: the bounty-completion approval flow
    // (app/postings/[bountyId]/review-and-verify or equivalent), with
    // metadata: { bountyId, counterpartName }.
    isEligible: eligibleWhenEnqueued,
    content: () => ({
      icon: 'star-outline',
      title: 'How did it go?',
      body: 'Rate your experience — it helps keep the marketplace trustworthy for everyone.',
      primaryLabel: 'Rate now',
      secondaryLabel: 'Skip',
    }),
    action: { type: 'navigate', route: '/tabs/bounty-app' },
  },
  {
    type: 'bounty_completed_followup',
    priority: 35,
    category: 'engagement',
    cooldownHours: 24,
    recurring: true,
    // Enqueue from: the same completion flow as rate_completed_bounty, for
    // the opposite party — e.g. nudging a poster whose bounty just wrapped
    // to post another one.
    isEligible: eligibleWhenEnqueued,
    content: () => ({
      icon: 'replay',
      title: 'Got another task?',
      body: 'That went well — post your next bounty and get it handled just as fast.',
      primaryLabel: 'Post another bounty',
      secondaryLabel: 'Not now',
    }),
    action: { type: 'navigate', route: '/tabs/postings-screen' },
  },
  {
    type: 'dispute_resolved_followup',
    priority: 36,
    category: 'trust',
    cooldownHours: 24,
    maxShownCount: 1,
    // Enqueue from: dispute-resolution handling (webhooks/index.ts
    // charge.dispute.closed, or the in-app dispute resolution flow), with
    // metadata: { disputeId, outcome }.
    isEligible: eligibleWhenEnqueued,
    content: () => ({
      icon: 'gavel',
      title: 'Your dispute has been resolved',
      body: 'See the outcome and what happens next for your account.',
      primaryLabel: 'View details',
    }),
    action: { type: 'navigate', route: '/tabs/wallet-screen' },
  },
  {
    type: 'large_payout_eligible',
    priority: 70,
    category: 'monetization',
    cooldownHours: 48,
    maxShownCount: 2,
    prerequisites: ['stripe_connect_onboarding'],
    // Enqueue from: wallet balance logic, when balance crosses a
    // "worth expediting" threshold and Connect is already set up.
    isEligible: eligibleWhenEnqueued,
    content: () => ({
      icon: 'trending-up',
      title: 'You have a payout ready',
      body: 'Your balance has reached a good time to withdraw. Transfer it to your bank now.',
      primaryLabel: 'Withdraw now',
      secondaryLabel: 'Later',
    }),
    action: { type: 'navigate', route: '/tabs/wallet-screen' },
  },
  {
    type: 'invite_friends',
    priority: 80,
    category: 'growth',
    cooldownHours: 168,
    maxShownCount: 2,
    // Enqueue from: after a positive milestone (e.g. first completed
    // bounty) — referrals convert best right after a good experience.
    // Gated on referralService.isReferralAvailable() (see
    // lib/moments/referral-service.ts) so this stays structurally dormant —
    // never eligible, never shown — until a real referral system ships,
    // even if something enqueues it early. Flipping that one function is
    // the only change needed to activate it.
    isEligible: (ctx, state) => referralService.isReferralAvailable() && eligibleWhenEnqueued(ctx, state),
    content: () => ({
      icon: 'group-add',
      title: 'Know someone who needs this?',
      body: 'Invite friends to Bounty — post or earn together.',
      primaryLabel: 'Invite friends',
      secondaryLabel: 'Not now',
    }),
    action: { type: 'inline', handlerKey: 'share_invite' },
  },
  {
    type: 'inactive_user_return',
    priority: 90,
    category: 'retention',
    cooldownHours: 168,
    maxShownCount: 1,
    // Enqueue from: app bootstrap, when daysSinceLastSession exceeds a
    // retention threshold (e.g. 14 days) — that computation needs a
    // last-session timestamp not currently tracked; see remaining work.
    isEligible: eligibleWhenEnqueued,
    content: () => ({
      icon: 'waving-hand',
      title: 'Welcome back',
      body: "Here's what's changed since you've been away — new bounties near you are waiting.",
      primaryLabel: 'See what’s new',
      secondaryLabel: 'Dismiss',
    }),
    action: { type: 'navigate', route: '/tabs/bounty-app' },
  },
  {
    type: 'feature_announcement',
    priority: 95,
    category: 'growth',
    cooldownHours: 24,
    maxShownCount: 1,
    // Enqueue from: a remote-config/feature-flag check at app start, with
    // metadata: { title, body, route } describing the specific announcement.
    isEligible: eligibleWhenEnqueued,
    content: (ctx) => ({
      icon: 'campaign',
      title: 'New feature',
      body: "There's something new in Bounty — take a look.",
      primaryLabel: 'Show me',
      secondaryLabel: 'Dismiss',
    }),
    action: { type: 'navigate', route: '/tabs/bounty-app' },
  },
];

export function getMomentDefinition(type: string): MomentDefinition | undefined {
  return MOMENT_REGISTRY.find((m) => m.type === type);
}
