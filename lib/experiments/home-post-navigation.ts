/**
 * `home_post_navigation_test`: does opening the app on the Post tab, with
 * Post in Home's centre slot of the tab bar, lead to more published bounties
 * than opening on the Home feed?
 *
 * Variants (multivariate PostHog flag):
 *   - `control`    Home is the launch tab and sits in the centre; Post is 4th.
 *   - `post_first` Post is the launch tab and sits in the centre; Home is 4th.
 *
 * Anything else (flag missing, off, not loaded in time, PostHog unavailable,
 * an unknown variant) renders exactly the control layout and records no
 * exposure, so turning the flag off in PostHog is the rollback.
 *
 * One answer per user per app process: the first call resolves it and every
 * later call (root gate, tab shell, a remount) gets the same value, so a flag
 * response that arrives mid-session cannot move tabs under the user. A
 * changed flag takes effect on the next cold start.
 *
 * Scope of the launch tab: only the root gate's cold-start landing
 * (app/index.tsx) asks for it. A notification, a deep link, a restored
 * last tab, and every in-app "back to the feed" link keep their own
 * destination in both variants, and the bare /tabs/bounty-app route still
 * opens Home. Sign-in and onboarding keep their current landing too.
 */

import { Platform } from 'react-native';
import { analyticsService } from '../services/analytics-service';
import {
  featureFlagsAreFor,
  featureFlagsSettledFor,
  getFeatureFlagResult,
  isPostHogReady,
  onFeatureFlagsSettled,
  register,
} from '../posthog';

export const HOME_POST_NAVIGATION_FLAG = 'home_post_navigation_test';

export type NavigationVariant = 'control' | 'post_first';

/**
 * - `enrolled`: the flag assigned a known variant; exposure is recorded.
 * - `not_enrolled`: the flag answered but this user is outside the rollout
 *   (off, excluded by a release condition, or an unknown variant).
 * - `flag_unavailable`: no trustworthy answer in time; control is shown.
 */
export type NavigationEnrollment = 'enrolled' | 'not_enrolled' | 'flag_unavailable';

export interface NavigationExperience {
  variant: NavigationVariant;
  enrollment: NavigationEnrollment;
}

export const CONTROL_EXPERIENCE: NavigationExperience = {
  variant: 'control',
  enrollment: 'flag_unavailable',
};

/** How long a launch waits for this user's flags before showing control. */
export const FLAG_WAIT_MS = 1200;

/** `entry` param the root gate adds to a post_first cold-start landing. */
export const APP_LAUNCH_ENTRY = 'app_launch';

const CONTROL_ORDER = ['messages', 'wallet', 'bounty', 'postings', 'profile'] as const;
const POST_FIRST_ORDER = ['messages', 'wallet', 'postings', 'bounty', 'profile'] as const;

/**
 * Left-to-right tab keys for the tab bar and the swipe pager. With the admin
 * tab on, Admin takes Profile's slot in the bar and drops out of the swipe
 * order (it pushes its own route).
 */
export function tabOrderFor(variant: NavigationVariant): readonly string[] {
  return variant === 'post_first' ? POST_FIRST_ORDER : CONTROL_ORDER;
}

export function swipeOrderFor(variant: NavigationVariant, withAdmin: boolean): string[] {
  const order = [...tabOrderFor(variant)];
  return withAdmin ? order.filter(key => key !== 'profile') : order;
}

/** The tab in the bar's centre slot, which gets the bar's emphasis. */
export function centerTabFor(variant: NavigationVariant): string {
  return tabOrderFor(variant)[2];
}

/** Where a cold start with nothing else to open lands. */
export function launchTabFor(variant: NavigationVariant): 'bounty' | 'postings' {
  return variant === 'post_first' ? 'postings' : 'bounty';
}

function evaluate(): NavigationExperience | null {
  const result = getFeatureFlagResult(HOME_POST_NAVIGATION_FLAG, { sendEvent: false });
  if (!result) return null;
  if (!result.enabled) return { variant: 'control', enrollment: 'not_enrolled' };
  if (result.variant === 'control' || result.variant === 'post_first') {
    return { variant: result.variant, enrollment: 'enrolled' };
  }
  return { variant: 'control', enrollment: 'not_enrolled' };
}

const resolved = new Map<string, NavigationExperience>();
const pending = new Map<string, Promise<NavigationExperience>>();

function settle(userId: string, experience: NavigationExperience): NavigationExperience {
  const existing = resolved.get(userId);
  if (existing) return existing;
  resolved.set(userId, experience);
  // On every later event, so analysis can split by what was rendered rather
  // than by `$feature/<flag>`, which follows the flag even in a session that
  // fell back to control.
  register({
    nav_experience:
      experience.enrollment === 'enrolled' ? experience.variant : experience.enrollment,
  });
  return experience;
}

/** This process's answer for `userId`, or undefined if not resolved yet. */
export function getResolvedNavigationExperience(userId: string): NavigationExperience | undefined {
  return resolved.get(userId);
}

/**
 * Resolves (once per process) which layout `userId` gets. Waits up to
 * `timeoutMs` for a /flags response for this user, so the kill switch and a
 * fresh sign-in's assignment are honoured; past that it uses the cache only
 * when the cache is this user's own, and otherwise shows control.
 * Never rejects.
 */
export function resolveNavigationExperience(
  userId: string,
  timeoutMs: number = FLAG_WAIT_MS
): Promise<NavigationExperience> {
  const done = resolved.get(userId);
  if (done) return Promise.resolve(done);
  const inFlight = pending.get(userId);
  if (inFlight) return inFlight;

  const promise = new Promise<NavigationExperience>(resolve => {
    if (!isPostHogReady()) {
      resolve(settle(userId, CONTROL_EXPERIENCE));
      return;
    }
    if (featureFlagsSettledFor(userId)) {
      resolve(settle(userId, evaluate() ?? CONTROL_EXPERIENCE));
      return;
    }
    let finished = false;
    let unsubscribe: () => void = () => {};
    const finish = (experience: NavigationExperience) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(settle(userId, experience));
    };
    const timer = setTimeout(() => {
      finish((featureFlagsAreFor(userId) ? evaluate() : null) ?? CONTROL_EXPERIENCE);
    }, timeoutMs);
    unsubscribe = onFeatureFlagsSettled(() => {
      if (featureFlagsSettledFor(userId)) finish(evaluate() ?? CONTROL_EXPERIENCE);
    });
  }).finally(() => {
    pending.delete(userId);
  });
  pending.set(userId, promise);
  return promise;
}

const exposed = new Set<string>();

function appVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return require('expo-application').nativeApplicationVersion || 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface ExposureContext {
  /** The tab the shell first rendered. */
  landingTab: string;
  /** Why it landed there: 'app_launch', 'link' (a tab named in the route), or 'default'. */
  landingReason: string;
  primaryRole: string | null;
  accountCreatedAt: string | null | undefined;
}

/**
 * Records that `userId` saw their assigned layout. Call it once the tab
 * shell has rendered with `experience`. At most once per user per process;
 * nothing for a user who isn't enrolled.
 */
export function recordNavigationExposure(
  userId: string,
  experience: NavigationExperience,
  context: ExposureContext
): void {
  if (experience.enrollment !== 'enrolled') return;
  if (exposed.has(userId)) return;
  exposed.add(userId);

  // The read that counts: `$feature_flag_called` at render, for PostHog's
  // default exposure. Earlier reads passed sendEvent: false.
  getFeatureFlagResult(HOME_POST_NAVIGATION_FLAG);

  const createdMs = context.accountCreatedAt ? Date.parse(context.accountCreatedAt) : NaN;
  const accountAgeDays = Number.isFinite(createdMs)
    ? Math.max(0, Math.floor((Date.now() - createdMs) / 86_400_000))
    : null;

  void analyticsService.trackEvent('navigation_experiment_exposed', {
    experiment: HOME_POST_NAVIGATION_FLAG,
    variant: experience.variant,
    [`$feature/${HOME_POST_NAVIGATION_FLAG}`]: experience.variant,
    landing_tab: context.landingTab,
    landing_reason: context.landingReason,
    // The tab shell exists only behind sign-in (app/tabs/_layout.tsx).
    auth_state: 'authenticated',
    primary_role: context.primaryRole ?? 'none',
    account_age_days: accountAgeDays,
    app_version: appVersion(),
    platform: Platform.OS,
  });
}

/** Test-only: forget every resolved answer and exposure. */
export function __resetNavigationExperimentForTests(): void {
  resolved.clear();
  pending.clear();
  exposed.clear();
}
