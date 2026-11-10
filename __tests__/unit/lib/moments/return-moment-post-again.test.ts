/**
 * inactive_user_return for a returning poster with a past bounty offers "Post
 * again" (P3) instead of the general welcome (lib/moments/registry.ts
 * postAgainTarget). Hunters, 'both', a poster with no bounty, and a moment
 * queued without a bounty keep the general welcome.
 */

import { evaluateNextMoment } from '../../../../lib/moments/engine';
import {
  MOMENT_REGISTRY,
  POST_AGAIN_BOUNTY_ID_KEY,
  POST_AGAIN_TITLE_KEY,
  postAgainTarget,
} from '../../../../lib/moments/registry';
import type { MomentContext, MomentState } from '../../../../lib/moments/types';

const returnMoment = MOMENT_REGISTRY.find(m => m.type === 'inactive_user_return')!;

function makeContext(
  role: MomentContext['profile']['primaryRole'] = 'poster',
  overrides: Partial<MomentContext> = {}
): MomentContext {
  return {
    userId: 'user-1',
    accountCreatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    sessionCount: 6,
    activeScreen: 'bounty',
    hasEngaged: true,
    hasPublishedBounty: true,
    profile: {
      hasAvatar: true,
      hasBio: true,
      hasLocation: true,
      hasSkills: true,
      idVerificationStatus: 'verified',
      stripeIdentityStatus: 'verified',
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
      primaryRole: role,
      balance: 0,
    },
    permissions: { notifications: 'granted', location: 'granted' },
    ...overrides,
  };
}

function queued(metadata: Record<string, unknown>): MomentState {
  return {
    momentType: 'inactive_user_return',
    status: 'pending',
    shownCount: 0,
    firstShownAt: null,
    lastShownAt: null,
    dismissedAt: null,
    completedAt: null,
    snoozedUntil: null,
    metadata,
  };
}

const withBounty = () =>
  queued({
    daysSinceLastSession: 21,
    [POST_AGAIN_BOUNTY_ID_KEY]: 'b-1',
    [POST_AGAIN_TITLE_KEY]: 'Haul away yard trash',
  });

const GENERAL = {
  title: 'Welcome back',
  primaryLabel: 'See what’s new',
};

describe('a returning poster with a past bounty', () => {
  it('is offered "Post again" for that bounty', () => {
    const ctx = makeContext();
    const state = withBounty();
    const content = returnMoment.content(ctx, state);
    expect(content.primaryLabel).toBe('Post again');
    expect(content.body).toContain('Haul away yard trash');
    expect(returnMoment.resolveAction!(ctx, state)).toEqual({ type: 'post_again', bountyId: 'b-1' });
  });

  it('is the moment the engine picks', () => {
    const states = new Map([['inactive_user_return' as const, withBounty()]]);
    expect(evaluateNextMoment(makeContext(), states)?.type).toBe('inactive_user_return');
  });

  it('works without a title', () => {
    const ctx = makeContext();
    const state = queued({ [POST_AGAIN_BOUNTY_ID_KEY]: 'b-1', [POST_AGAIN_TITLE_KEY]: '  ' });
    expect(returnMoment.content(ctx, state).body).toContain('your last job');
    expect(returnMoment.resolveAction!(ctx, state)).toEqual({ type: 'post_again', bountyId: 'b-1' });
  });

  it('counts a user with no role who has posted', () => {
    expect(postAgainTarget(makeContext(null), withBounty())).toEqual({
      bountyId: 'b-1',
      title: 'Haul away yard trash',
    });
  });
});

describe('the general welcome stays for', () => {
  it.each([
    ['a hunter', makeContext('hunter'), withBounty()],
    ['both', makeContext('both'), withBounty()],
    ['a poster with no bounty', makeContext('poster', { hasPublishedBounty: false }), withBounty()],
    ['a moment queued without a bounty', makeContext(), queued({ daysSinceLastSession: 21 })],
    ['a non-string bounty id', makeContext(), queued({ [POST_AGAIN_BOUNTY_ID_KEY]: 42 })],
    ['no state', makeContext(), null],
  ] as const)('%s', (_label, ctx, state) => {
    const content = returnMoment.content(ctx, state);
    expect(content).toMatchObject(GENERAL);
    expect(returnMoment.resolveAction!(ctx, state)).toBeNull();
    expect(returnMoment.action).toEqual({ type: 'navigate', route: '/tabs/bounty-app' });
  });
});
