/**
 * Poster-first moments (lib/moments/registry.ts heldUntilFirstPost, applied in
 * engine.ts):
 *  - a declared poster with no published bounty sees post_first_bounty and
 *    nothing else;
 *  - her first publish releases the held moments under their own rules, in
 *    their normal priority order, with enable_notifications first and asking
 *    "so you hear when someone applies";
 *  - hunters, 'both' and an unset role are unchanged.
 */

import { evaluateEligibleMoments, evaluateNextMoment } from '../../../../lib/moments/engine';
import {
  FIRST_POST_MOMENT,
  heldUntilFirstPost,
  isUnpublishedPoster,
  MOMENT_REGISTRY,
} from '../../../../lib/moments/registry';
import type { MomentContext, MomentState, MomentType } from '../../../../lib/moments/types';

type Role = MomentContext['profile']['primaryRole'];

/**
 * The worst case for a new poster: a later session, on the wallet, with money
 * in it, nothing on her profile, nothing verified, no permission answered.
 * Every state-derived moment has its own reason to show here.
 */
function makeContext(overrides: Partial<MomentContext> = {}, role: Role = 'poster'): MomentContext {
  return {
    userId: 'user-1',
    accountCreatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    sessionCount: 5,
    activeScreen: 'wallet',
    hasEngaged: false,
    hasPublishedBounty: false,
    profile: {
      hasAvatar: false,
      hasBio: false,
      hasLocation: false,
      hasSkills: false,
      idVerificationStatus: 'unverified',
      stripeIdentityStatus: null,
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
      primaryRole: role,
      balance: 500,
    },
    permissions: { notifications: 'undetermined', location: 'undetermined' },
    ...overrides,
  };
}

function pending(type: MomentType): MomentState {
  return {
    momentType: type,
    status: 'pending',
    shownCount: 0,
    firstShownAt: null,
    lastShownAt: null,
    dismissedAt: null,
    completedAt: null,
    snoozedUntil: null,
    metadata: {},
  };
}

/** Every event-triggered moment enqueued at once, as if each event had fired. */
function everythingEnqueued(): Map<MomentType, MomentState> {
  return new Map(MOMENT_REGISTRY.map(def => [def.type, pending(def.type)]));
}

const types = (ctx: MomentContext, states = everythingEnqueued()) =>
  evaluateEligibleMoments(ctx, states).map(m => m.type);

describe('a poster with no published bounty', () => {
  it('sees only post_first_bounty when every other moment has a reason to show', () => {
    // post_first_bounty wants Feed or Activity, so stand there.
    const ctx = makeContext({ activeScreen: 'bounty' });
    expect(types(ctx)).toEqual([FIRST_POST_MOMENT]);
  });

  it('holds every moment in the registry except post_first_bounty', () => {
    const ctx = makeContext({ activeScreen: 'bounty' });
    const eligible = new Set(types(ctx));
    for (const def of MOMENT_REGISTRY) {
      if (def.type === FIRST_POST_MOMENT) continue;
      expect({ type: def.type, eligible: eligible.has(def.type) }).toEqual({
        type: def.type,
        eligible: false,
      });
    }
  });

  it.each([
    'add_profile_photo',
    'complete_profile',
    'identity_verification',
    'fund_wallet',
    'large_payout_eligible',
    'enable_notifications',
    'enable_location',
    'inactive_user_return',
  ] as MomentType[])('holds %s, which shows once she has published', type => {
    const states = everythingEnqueued();
    states.delete(FIRST_POST_MOMENT);
    const screen = type === 'add_profile_photo' ? 'profile' : 'wallet';
    const held = makeContext({ activeScreen: screen });
    const released = makeContext({ activeScreen: screen, hasPublishedBounty: true, hasEngaged: true });
    expect(types(held, states)).not.toContain(type);
    expect(types(released, states)).toContain(type);
  });

  it('never offers payout setup (hunter-only before and after)', () => {
    const states = everythingEnqueued();
    const released = makeContext({ hasPublishedBounty: true, hasEngaged: true });
    expect(types(makeContext(), states)).not.toContain('stripe_connect_onboarding');
    expect(types(released, states)).not.toContain('stripe_connect_onboarding');
  });

  it('sees nothing at all in her first session (post_first_bounty waits for session 2)', () => {
    const ctx = makeContext({ sessionCount: 1, activeScreen: 'bounty' });
    expect(types(ctx)).toEqual([]);
  });

  it('still sees post_first_bounty when the hold is the only thing between her and it', () => {
    const states = new Map<MomentType, MomentState>([[FIRST_POST_MOMENT, pending(FIRST_POST_MOMENT)]]);
    const ctx = makeContext({ activeScreen: 'postings' });
    expect(evaluateNextMoment(ctx, states)?.type).toBe(FIRST_POST_MOMENT);
  });
});

describe('after her first publish', () => {
  function published(overrides: Partial<MomentContext> = {}): MomentContext {
    return makeContext({ hasPublishedBounty: true, hasEngaged: true, ...overrides });
  }

  // A poster usually has nothing in her wallet. With money in it and no bank,
  // large_payout_eligible (priority 1) rightly comes first.
  const noBalance = { ...makeContext().profile, balance: 0 };

  function afterPublishStates(): Map<MomentType, MomentState> {
    // The bounties insert trigger completes post_first_bounty.
    const states = everythingEnqueued();
    states.set(FIRST_POST_MOMENT, { ...pending(FIRST_POST_MOMENT), status: 'completed' });
    return states;
  }

  it('offers enable_notifications first', () => {
    const ctx = published({ activeScreen: 'postings', profile: noBalance });
    expect(evaluateNextMoment(ctx, afterPublishStates())?.type).toBe('enable_notifications');
  });

  it('offers it in the same session she published in', () => {
    // hasEngaged clears the first-session rule; nothing else needs a later visit.
    const ctx = published({ sessionCount: 1, activeScreen: 'postings', profile: noBalance });
    expect(evaluateNextMoment(ctx, afterPublishStates())?.type).toBe('enable_notifications');
  });

  it('asks so she hears when someone applies', () => {
    const ctx = published({ sessionCount: 1, activeScreen: 'postings', profile: noBalance });
    const content = evaluateNextMoment(ctx, afterPublishStates())!.content(ctx);
    expect(content.body).toContain('so you hear when someone applies');
    expect(content.title).toBe('Hear when someone applies');
  });

  it('releases the held moments in their normal priority order', () => {
    const ctx = published();
    const eligible = evaluateEligibleMoments(ctx, afterPublishStates());
    const priorities = eligible.map(m => m.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(eligible.map(m => m.type)).toEqual(
      expect.arrayContaining([
        'enable_notifications',
        'fund_wallet',
        'complete_profile',
        'identity_verification',
      ])
    );
    expect(eligible.map(m => m.type)).not.toContain(FIRST_POST_MOMENT);
  });

  it('releases each held moment under its own rules, not all at once', () => {
    // First session after publishing, not on Profile: the photo prompt still
    // waits for its third session, ID still waits for a reason or a later visit.
    const ctx = published({
      sessionCount: 1,
      activeScreen: 'postings',
      profile: noBalance,
    });
    const eligible = types(ctx, afterPublishStates());
    expect(eligible).not.toContain('add_profile_photo');
    expect(eligible).not.toContain('identity_verification');
    expect(eligible[0]).toBe('enable_notifications');
  });

  it('a moment held earlier was never resolved, so it can still show', () => {
    // The hold writes nothing; the rows a poster had stay as they were.
    const states = afterPublishStates();
    const before = JSON.stringify([...states]);
    evaluateEligibleMoments(makeContext(), states);
    expect(JSON.stringify([...states])).toBe(before);
  });
});

describe('who the hold applies to', () => {
  it('is only a declared poster without a published bounty', () => {
    expect(isUnpublishedPoster('poster', false)).toBe(true);
    expect(isUnpublishedPoster('poster', true)).toBe(false);
    for (const role of ['hunter', 'both', null, undefined] as const) {
      expect(isUnpublishedPoster(role, false)).toBe(false);
      expect(isUnpublishedPoster(role, true)).toBe(false);
    }
    expect(heldUntilFirstPost(makeContext())).toBe(true);
  });
});

describe('hunters are unchanged', () => {
  /** What the engine picked for these roles before the hold existed. */
  const HUNTER_BEFORE: Record<'hunter' | 'both', MomentType[]> = {
    hunter: [
      'large_payout_eligible',
      'accept_first_bounty',
      'enable_notifications',
      'fund_wallet',
      'add_profile_photo',
      'rate_completed_bounty',
      'complete_profile',
      'bounty_completed_followup',
      'dispute_resolved_followup',
      'enable_location',
      'identity_verification',
      'stripe_connect_onboarding',
      'inactive_user_return',
      'feature_announcement',
    ],
    both: [],
  };
  HUNTER_BEFORE.both = HUNTER_BEFORE.hunter;

  it.each(['hunter', 'both'] as const)('a %s sees the same moments as before', role => {
    const ctx = makeContext({ activeScreen: 'bounty' }, role);
    const states = everythingEnqueued();
    // Compare the hunter-side moments ('both' also gets post_first_bounty,
    // which the hold doesn't touch either). Spelled out
    // (not FIRST_POST_MOMENT) so this test also runs against the pre-hold engine.
    states.delete('post_first_bounty');
    expect(types(ctx, states)).toEqual(HUNTER_BEFORE[role]);
  });

  it.each(['hunter', 'both', null] as const)(
    'publishing changes nothing for role %s',
    role => {
      const states = everythingEnqueued();
      const before = types(makeContext({}, role), states);
      const after = types(makeContext({ hasPublishedBounty: true }, role), states);
      // Trust prompts were already open to hunters; for no role, publishing
      // only lifts the existing trust hold (identity_verification).
      const lifted = role === null ? ['identity_verification', 'dispute_resolved_followup'] : [];
      expect(after.filter(t => !lifted.includes(t))).toEqual(before);
    }
  );

  it('keeps the general notification copy for a hunter', () => {
    const ctx = makeContext({ hasPublishedBounty: true, hasEngaged: true }, 'hunter');
    const def = MOMENT_REGISTRY.find(m => m.type === 'enable_notifications')!;
    expect(def.content(ctx).title).toBe('Know the moment money is nearby');
  });
});
