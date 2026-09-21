/**
 * Unit tests for the Moments Queue evaluation engine, focused on the
 * cooldown/retirement rules that keep activation prompts (e.g. identity
 * verification) from re-showing too frequently.
 */

import { evaluateEligibleMoments, evaluateNextMoment } from '../../../../lib/moments/engine';
import type {
    MomentContext,
    MomentDefinition,
    MomentState,
    MomentType,
} from '../../../../lib/moments/types';

const HOUR_MS = 60 * 60 * 1000;

function makeContext(overrides: Partial<MomentContext> = {}): MomentContext {
  return {
    userId: 'user-1',
    accountCreatedAt: new Date().toISOString(),
    sessionCount: 1,
    activeScreen: null,
    hasEngaged: false,
    profile: {
      hasAvatar: false,
      hasBio: false,
      hasLocation: false,
      hasSkills: false,
      idVerificationStatus: 'unverified',
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
      primaryRole: 'hunter',
      balance: 0,
    },
    permissions: {
      notifications: 'undetermined',
      location: 'undetermined',
    },
    ...overrides,
  };
}

function makeState(overrides: Partial<MomentState> = {}): MomentState {
  return {
    momentType: 'identity_verification',
    status: 'pending',
    shownCount: 0,
    firstShownAt: null,
    lastShownAt: null,
    dismissedAt: null,
    completedAt: null,
    snoozedUntil: null,
    metadata: {},
    ...overrides,
  };
}

function makeDef(overrides: Partial<MomentDefinition> = {}): MomentDefinition {
  return {
    type: 'identity_verification',
    priority: 50,
    category: 'trust',
    cooldownHours: 96,
    isEligible: () => true,
    content: () => ({ title: 't', body: 'b', primaryLabel: 'Go' }),
    action: { type: 'navigate', route: '/somewhere' },
    ...overrides,
  };
}

describe('evaluateNextMoment cooldown handling', () => {
  it('keeps a currently-active (shown, unresolved) moment eligible on repeated re-evaluation', () => {
    // A moment marked 'shown' must stay eligible on every subsequent
    // evaluation while it's still on screen and unresolved — otherwise it
    // would flip ineligible on its own cooldown the instant it's shown and
    // close itself before the user does anything (see isOnCooldown's doc
    // comment for why this is deliberately NOT treated as a cooldown case).
    const def = makeDef();
    const state = makeState({
      status: 'shown',
      shownCount: 1,
      lastShownAt: new Date(Date.now() - 1 * HOUR_MS).toISOString(),
    });
    const states = new Map<MomentType, MomentState>([[def.type, state]]);

    expect(evaluateNextMoment(makeContext(), states, [def])?.type).toBe(def.type);
  });

  it('does not re-show a moment recently dismissed within its cooldown window', () => {
    const def = makeDef({ cooldownHours: 96 });
    const state = makeState({
      status: 'dismissed',
      shownCount: 1,
      lastShownAt: new Date(Date.now() - 10 * HOUR_MS).toISOString(),
      dismissedAt: new Date(Date.now() - 10 * HOUR_MS).toISOString(),
    });
    const states = new Map<MomentType, MomentState>([[def.type, state]]);

    expect(evaluateNextMoment(makeContext(), states, [def])).toBeNull();
  });

  it.each(['dismissed', 'completed', 'expired'] as const)(
    'never re-selects a %s moment after it is resolved',
    status => {
      const def = makeDef({ maxShownCount: 99 });
      const state = makeState({ status, shownCount: 1 });
      const states = new Map<MomentType, MomentState>([[def.type, state]]);

      expect(evaluateNextMoment(makeContext(), states, [def])).toBeNull();
    }
  );

  it('respects an active snooze regardless of lastShownAt', () => {
    const def = makeDef();
    const state = makeState({
      status: 'snoozed',
      lastShownAt: new Date(Date.now() - 1000 * HOUR_MS).toISOString(),
      snoozedUntil: new Date(Date.now() + 1 * HOUR_MS).toISOString(),
    });
    const states = new Map<MomentType, MomentState>([[def.type, state]]);

    expect(evaluateNextMoment(makeContext(), states, [def])).toBeNull();
  });

  it('allows an expired snooze to be selected again', () => {
    const def = makeDef();
    const state = makeState({
      status: 'snoozed',
      lastShownAt: new Date(Date.now() - 1000 * HOUR_MS).toISOString(),
      snoozedUntil: new Date(Date.now() - 1 * HOUR_MS).toISOString(),
    });
    const states = new Map<MomentType, MomentState>([[def.type, state]]);

    expect(evaluateNextMoment(makeContext(), states, [def])?.type).toBe(def.type);
  });

  it('retires a moment once maxShownCount is reached, even without a dismissal', () => {
    const def = makeDef({ maxShownCount: 2 });
    const state = makeState({
      status: 'shown',
      shownCount: 2,
      lastShownAt: new Date(Date.now() - 1000 * HOUR_MS).toISOString(),
    });
    const states = new Map<MomentType, MomentState>([[def.type, state]]);

    expect(evaluateNextMoment(makeContext(), states, [def])).toBeNull();
  });

  it('enforces the universal three-show backstop even when a definition asks for more', () => {
    const def = makeDef({ maxShownCount: 99 });
    const state = makeState({ status: 'shown', shownCount: 3 });
    const states = new Map<MomentType, MomentState>([[def.type, state]]);

    expect(evaluateNextMoment(makeContext(), states, [def])).toBeNull();
  });

  // BNTY-09: enable_notifications/complete_profile could flash on screen for
  // one render even though their goal was already met (permission already
  // granted, bio/location already filled in) — evaluateNextMoment used to
  // rely solely on isEligible + persisted status, and only the separate,
  // async MomentsProvider auto-complete effect ever consulted
  // checkCompleted, which raced against selection. checkCompleted is now
  // checked at selection time too, so a moment whose goal is already met is
  // never selected regardless of what status happens to be persisted.
  it.each(['pending', 'shown', 'dismissed', 'snoozed'] as const)(
    'does not select a moment whose checkCompleted already returns true, even with a %s persisted status',
    status => {
      const def = makeDef({
        isEligible: () => true,
        checkCompleted: () => true,
      });
      const state = makeState({
        status,
        shownCount: 1,
        snoozedUntil:
          status === 'snoozed' ? new Date(Date.now() + 1 * HOUR_MS).toISOString() : null,
      });
      const states = new Map<MomentType, MomentState>([[def.type, state]]);

      expect(evaluateNextMoment(makeContext(), states, [def])).toBeNull();
    }
  );

  it('does not select a moment whose checkCompleted already returns true even with no persisted state at all', () => {
    // The "already granted before this device ever showed anything" case —
    // no user_activation_moments row exists yet.
    const def = makeDef({ isEligible: () => true, checkCompleted: () => true });

    expect(evaluateNextMoment(makeContext(), new Map(), [def])).toBeNull();
  });

  it('still selects a moment whose checkCompleted returns false', () => {
    const def = makeDef({ isEligible: () => true, checkCompleted: () => false });

    expect(evaluateNextMoment(makeContext(), new Map(), [def])?.type).toBe(def.type);
  });

  it('never surfaces more than one eligible moment at a time', () => {
    const defA = makeDef({ type: 'identity_verification', priority: 50 });
    const defB = makeDef({ type: 'enable_notifications', priority: 10 });
    const eligible = evaluateEligibleMoments(makeContext(), new Map(), [defA, defB]);

    expect(eligible.map(d => d.type)).toEqual(['enable_notifications', 'identity_verification']);
    expect(evaluateNextMoment(makeContext(), new Map(), [defA, defB])?.type).toBe(
      'enable_notifications'
    );
  });
});
