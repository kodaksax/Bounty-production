/**
 * Moments Queue — evaluation engine.
 *
 * Pure functions, no I/O, no React — this is the single place that decides
 * "what activation prompt, if any, should this user see right now." Every
 * other part of the app (MomentsProvider, future surfaces like a
 * notification-center screen) calls into this rather than re-implementing
 * eligibility checks, which is what keeps moment logic out of individual
 * screens.
 */

import { MOMENT_REGISTRY } from './registry';
import type { MomentContext, MomentDefinition, MomentState, MomentType } from './types';

const MS_PER_HOUR = 60 * 60 * 1000;

function isOnCooldown(def: MomentDefinition, state: MomentState | null): boolean {
  if (!state) return false;
  if (state.status === 'snoozed' && state.snoozedUntil) {
    return new Date(state.snoozedUntil).getTime() > Date.now();
  }
  // Deliberately NOT applied to 'shown': a currently-active moment must
  // stay eligible on every re-evaluation while it's still on screen and
  // unresolved, or the caller's "same type as last time → keep it" bailout
  // (see MomentsProvider's compute-next-moment effect) never gets a chance
  // to run — the moment would flip eligible→ineligible→eligible on its own
  // cooldown the instant it's marked shown, closing itself before the user
  // does anything. A moment left 'shown' across many separate sessions
  // without ever being resolved is already bounded by maxShownCount instead.
  if (state.status === 'dismissed' && state.lastShownAt) {
    return Date.now() - new Date(state.lastShownAt).getTime() < def.cooldownHours * MS_PER_HOUR;
  }
  return false;
}

function isRetired(def: MomentDefinition, state: MomentState | null): boolean {
  if (!state) return false;
  if (state.status === 'completed' && !def.recurring) return true;
  if (state.status === 'expired') return true;
  if (def.maxShownCount != null && state.shownCount >= def.maxShownCount) return true;
  return false;
}

function prerequisitesMet(def: MomentDefinition, states: Map<MomentType, MomentState>): boolean {
  if (!def.prerequisites || def.prerequisites.length === 0) return true;
  return def.prerequisites.every((p) => states.get(p)?.status === 'completed');
}

/**
 * Returns every moment currently eligible to show, sorted by priority
 * (highest priority — lowest number — first). Most callers want
 * evaluateNextMoment instead; this is exposed for surfaces that might want
 * the full picture (e.g. a future "notifications center" listing all
 * pending activation items).
 */
export function evaluateEligibleMoments(
  ctx: MomentContext,
  states: Map<MomentType, MomentState>,
  registry: MomentDefinition[] = MOMENT_REGISTRY
): MomentDefinition[] {
  const eligible = registry.filter((def) => {
    const state = states.get(def.type) ?? null;
    if (isRetired(def, state)) return false;
    if (isOnCooldown(def, state)) return false;
    if (!prerequisitesMet(def, states)) return false;
    try {
      return def.isEligible(ctx, state);
    } catch (err) {
      console.error(`[moments] isEligible threw for "${def.type}"`, err);
      return false;
    }
  });

  return eligible.sort((a, b) => a.priority - b.priority);
}

/**
 * The primary entry point: exactly one moment (or null), so callers never
 * have to remember the "never overwhelm users with multiple prompts"
 * rule themselves — it's structural here.
 */
export function evaluateNextMoment(
  ctx: MomentContext,
  states: Map<MomentType, MomentState>,
  registry: MomentDefinition[] = MOMENT_REGISTRY
): MomentDefinition | null {
  const [next] = evaluateEligibleMoments(ctx, states, registry);
  return next ?? null;
}
