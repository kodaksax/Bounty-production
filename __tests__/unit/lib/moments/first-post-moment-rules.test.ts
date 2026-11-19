/**
 * SBA-06 eligibility rules (lib/moments/registry.ts + engine.ts):
 *  - a poster (or a user with no role yet) sees no trust/ID prompt until they
 *    have published a bounty; hunters keep the rules each moment defines;
 *  - location is never a sheet: enable_location left the queue and is asked
 *    where a feature needs it (feed Distance filter, composer location);
 *  - the session boundary uses this runtime's own record of a session write,
 *    since the in-memory profile is never re-read after it.
 */

import { evaluateEligibleMoments } from '../../../../lib/moments/engine';
import { MOMENT_REGISTRY, trustPromptsAllowed } from '../../../../lib/moments/registry';
import {
  effectiveLastSessionAt,
  noteSessionRecorded,
  resetSessionRecordsForTests,
  shouldRecordSession,
} from '../../../../lib/moments/sessionTracking';
import type { MomentContext } from '../../../../lib/moments/types';

function makeContext(overrides: Partial<MomentContext> = {}): MomentContext {
  return {
    userId: 'user-1',
    accountCreatedAt: new Date().toISOString(),
    sessionCount: 5,
    activeScreen: 'wallet',
    hasEngaged: false,
    hasPublishedBounty: false,
    profile: {
      hasAvatar: true,
      hasBio: true,
      hasLocation: true,
      hasSkills: true,
      idVerificationStatus: 'unverified',
      stripeIdentityStatus: null,
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
      primaryRole: 'poster',
      balance: 500,
    },
    permissions: { notifications: 'granted', location: 'granted' },
    ...overrides,
  };
}

const eligibleTypes = (ctx: MomentContext) =>
  evaluateEligibleMoments(ctx, new Map()).map(m => m.type);

describe('trust/ID prompts before the first published bounty', () => {
  it('blocks every trust moment for a poster who has not published, whatever else is true', () => {
    const ctx = makeContext();
    expect(trustPromptsAllowed(ctx)).toBe(false);
    expect(eligibleTypes(ctx)).not.toContain('identity_verification');
    const trust = MOMENT_REGISTRY.filter(m => m.category === 'trust').map(m => m.type);
    expect(trust.length).toBeGreaterThan(0);
    for (const type of trust) expect(eligibleTypes(ctx)).not.toContain(type);
  });

  it('treats a user with no role yet as a poster', () => {
    const ctx = makeContext({ profile: { ...makeContext().profile, primaryRole: null } });
    expect(eligibleTypes(ctx)).not.toContain('identity_verification');
  });

  it('allows the ID prompt again once the poster has published', () => {
    const ctx = makeContext({ hasPublishedBounty: true, hasEngaged: true });
    expect(eligibleTypes(ctx)).toContain('identity_verification');
  });

  it('does not count an application as publishing', () => {
    const ctx = makeContext({ hasEngaged: true, hasPublishedBounty: false });
    expect(eligibleTypes(ctx)).not.toContain('identity_verification');
  });

  it.each(['hunter', 'both'] as const)('leaves a %s on the existing rules', role => {
    const ctx = makeContext({ profile: { ...makeContext().profile, primaryRole: role } });
    expect(trustPromptsAllowed(ctx)).toBe(true);
    expect(eligibleTypes(ctx)).toContain('identity_verification');
  });
});

describe('sheets that used to meet a returning user at sign-in', () => {
  it('enable_location and complete_profile are no longer moments', () => {
    const types = MOMENT_REGISTRY.map(m => m.type);
    expect(types).not.toContain('enable_location');
    expect(types).not.toContain('complete_profile');
  });
});

describe('session boundary', () => {
  beforeEach(() => resetSessionRecordsForTests());

  it('stops counting a new session once this runtime has recorded one, even with a stale null profile', () => {
    expect(shouldRecordSession(effectiveLastSessionAt('user-1', null))).toBe(true);
    noteSessionRecorded('user-1', new Date().toISOString());
    expect(shouldRecordSession(effectiveLastSessionAt('user-1', null))).toBe(false);
  });

  it('is per user', () => {
    noteSessionRecorded('user-1', new Date().toISOString());
    expect(effectiveLastSessionAt('user-2', null)).toBeNull();
  });

  it('prefers whichever of the profile and the local record is later', () => {
    const older = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const newer = new Date().toISOString();
    noteSessionRecorded('user-1', older);
    expect(effectiveLastSessionAt('user-1', newer)).toBe(newer);
    noteSessionRecorded('user-1', newer);
    expect(effectiveLastSessionAt('user-1', older)).toBe(newer);
  });
});
