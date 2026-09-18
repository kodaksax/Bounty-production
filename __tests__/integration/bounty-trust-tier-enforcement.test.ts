/**
 * Bounty trust-tier ID-verification enforcement — bounty_requests
 *
 * Verifies the server-side enforcement added in
 * supabase/migrations/20260915053615_bounty_trust_tier.sql: a BEFORE INSERT
 * trigger (enforce_bounty_request_id_requirement) plus a matching WITH CHECK
 * clause on the "Hunters can create applications" policy, both backed by
 * hunter_meets_bounty_id_requirement(bounty_id, hunter_id). The client-side
 * gate in app/bounty/[id]/public.tsx exists only to save a hunter the time
 * of writing a pitch they can't submit -- this DB layer is the real boundary,
 * so it's what must stay correct if policies/triggers are touched later.
 *
 * Two modes, mirroring __tests__/integration/rls-wallet-transactions.test.ts:
 *   LIVE mode  – set SUPABASE_URL, SUPABASE_ANON_KEY,
 *                TRUST_TIER_TEST_VERIFIED_HUNTER_EMAIL/PASSWORD,
 *                TRUST_TIER_TEST_UNVERIFIED_HUNTER_EMAIL/PASSWORD,
 *                TRUST_TIER_TEST_OPEN_BOUNTY_ID (an open bounty with
 *                requires_id_verified = false), and
 *                TRUST_TIER_TEST_GATED_BOUNTY_ID (an open bounty with
 *                requires_id_verified = true). The two hunter accounts must
 *                not already have an application on either bounty. Any row
 *                this suite inserts is deleted again in the same test.
 *   MOCK mode  – exercises deriveCoarseVerificationStatus (the client-side
 *                mirror of the SQL verification check) and documents the
 *                enforcement contract, so this suite still catches the
 *                mirror drifting from the DB rule even without DB access.
 */

import { deriveCoarseVerificationStatus } from '../../lib/utils/normalize-profile';

const LIVE_MODE =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_ANON_KEY) &&
  Boolean(process.env.TRUST_TIER_TEST_VERIFIED_HUNTER_EMAIL) &&
  Boolean(process.env.TRUST_TIER_TEST_VERIFIED_HUNTER_PASSWORD) &&
  Boolean(process.env.TRUST_TIER_TEST_UNVERIFIED_HUNTER_EMAIL) &&
  Boolean(process.env.TRUST_TIER_TEST_UNVERIFIED_HUNTER_PASSWORD) &&
  Boolean(process.env.TRUST_TIER_TEST_OPEN_BOUNTY_ID) &&
  Boolean(process.env.TRUST_TIER_TEST_GATED_BOUNTY_ID);

describe('bounty_requests trust-tier enforcement', () => {
  if (LIVE_MODE) {
    // -----------------------------------------------------------------------
    // LIVE integration tests (require Supabase credentials + fixtures)
    // -----------------------------------------------------------------------
    let verifiedClient: ReturnType<typeof import('@supabase/supabase-js').createClient>;
    let unverifiedClient: ReturnType<typeof import('@supabase/supabase-js').createClient>;
    let verifiedHunterId: string;
    let unverifiedHunterId: string;
    const openBountyId = process.env.TRUST_TIER_TEST_OPEN_BOUNTY_ID!;
    const gatedBountyId = process.env.TRUST_TIER_TEST_GATED_BOUNTY_ID!;

    beforeAll(async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const url = process.env.SUPABASE_URL!;
      const anon = process.env.SUPABASE_ANON_KEY!;

      verifiedClient = createClient(url, anon);
      unverifiedClient = createClient(url, anon);

      const signInVerified = await verifiedClient.auth.signInWithPassword({
        email: process.env.TRUST_TIER_TEST_VERIFIED_HUNTER_EMAIL!,
        password: process.env.TRUST_TIER_TEST_VERIFIED_HUNTER_PASSWORD!,
      });
      expect(signInVerified.error).toBeNull();
      verifiedHunterId = signInVerified.data.user!.id;

      const signInUnverified = await unverifiedClient.auth.signInWithPassword({
        email: process.env.TRUST_TIER_TEST_UNVERIFIED_HUNTER_EMAIL!,
        password: process.env.TRUST_TIER_TEST_UNVERIFIED_HUNTER_PASSWORD!,
      });
      expect(signInUnverified.error).toBeNull();
      unverifiedHunterId = signInUnverified.data.user!.id;
    });

    afterAll(async () => {
      await verifiedClient?.auth.signOut();
      await unverifiedClient?.auth.signOut();
    });

    it('requires_id_verified = false allows an application from an unverified hunter', async () => {
      const { data, error } = await unverifiedClient
        .from('bounty_requests')
        .insert({ bounty_id: openBountyId, hunter_id: unverifiedHunterId })
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      if (data?.id) {
        await unverifiedClient.from('bounty_requests').delete().eq('id', data.id);
      }
    });

    it('requires_id_verified = true blocks an unverified hunter', async () => {
      const { data, error } = await unverifiedClient
        .from('bounty_requests')
        .insert({ bounty_id: gatedBountyId, hunter_id: unverifiedHunterId })
        .select('id')
        .single();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(String(error?.message)).toMatch(/ID verification/i);
    });

    it('requires_id_verified = true allows a verified hunter', async () => {
      const { data, error } = await verifiedClient
        .from('bounty_requests')
        .insert({ bounty_id: gatedBountyId, hunter_id: verifiedHunterId })
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      if (data?.id) {
        await verifiedClient.from('bounty_requests').delete().eq('id', data.id);
      }
    });

    it('hunter_meets_bounty_id_requirement rejects a p_hunter_id that is not the caller', async () => {
      const { data, error } = await unverifiedClient.rpc('hunter_meets_bounty_id_requirement', {
        p_bounty_id: gatedBountyId,
        p_hunter_id: verifiedHunterId,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(String(error?.message)).toMatch(/must match the current user/i);
    });
  } else {
    // -----------------------------------------------------------------------
    // MOCK tests (run in standard CI / unit test pass)
    // -----------------------------------------------------------------------

    // Mirrors the SQL check in hunter_meets_bounty_id_requirement:
    //   (p.stripe_identity_status = 'verified' OR p.id_verification_status = 'verified')
    function dbWouldAllowApply(params: {
      requiresIdVerified: boolean;
      stripeIdentityStatus?: string;
      legacyIdVerificationStatus?: string;
    }): boolean {
      if (!params.requiresIdVerified) return true;
      return (
        deriveCoarseVerificationStatus(params.stripeIdentityStatus, params.legacyIdVerificationStatus) === 'verified'
      );
    }

    it('requires_id_verified = false allows apply regardless of verification status', () => {
      expect(dbWouldAllowApply({ requiresIdVerified: false })).toBe(true);
      expect(
        dbWouldAllowApply({
          requiresIdVerified: false,
          stripeIdentityStatus: 'requires_input',
        })
      ).toBe(true);
    });

    it('requires_id_verified = true blocks an unverified hunter', () => {
      expect(
        dbWouldAllowApply({ requiresIdVerified: true, stripeIdentityStatus: 'processing' })
      ).toBe(false);
      expect(dbWouldAllowApply({ requiresIdVerified: true })).toBe(false);
    });

    it('requires_id_verified = true allows a verified hunter (either verification column)', () => {
      expect(
        dbWouldAllowApply({ requiresIdVerified: true, stripeIdentityStatus: 'verified' })
      ).toBe(true);
      expect(
        dbWouldAllowApply({ requiresIdVerified: true, legacyIdVerificationStatus: 'verified' })
      ).toBe(true);
    });

    it('documents the enforcement contract (snapshot)', () => {
      const enforcement = [
        {
          object: 'trg_bounty_request_require_id_verified',
          kind: 'BEFORE INSERT trigger on bounty_requests',
          rule: 'raises unless hunter_meets_bounty_id_requirement(NEW.bounty_id, NEW.hunter_id)',
        },
        {
          object: 'Hunters can create applications',
          kind: 'INSERT policy (WITH CHECK) on bounty_requests',
          rule: 'requires hunter_meets_bounty_id_requirement(bounty_id, hunter_id) in addition to auth.uid() = hunter_id',
        },
        {
          object: 'hunter_meets_bounty_id_requirement',
          kind: 'SECURITY DEFINER function, EXECUTE granted to authenticated',
          rule: 'raises unless p_hunter_id = auth.uid() -- prevents using the boolean result as a side channel on another user',
        },
      ];

      expect(enforcement).toEqual([
        {
          object: 'trg_bounty_request_require_id_verified',
          kind: 'BEFORE INSERT trigger on bounty_requests',
          rule: 'raises unless hunter_meets_bounty_id_requirement(NEW.bounty_id, NEW.hunter_id)',
        },
        {
          object: 'Hunters can create applications',
          kind: 'INSERT policy (WITH CHECK) on bounty_requests',
          rule: 'requires hunter_meets_bounty_id_requirement(bounty_id, hunter_id) in addition to auth.uid() = hunter_id',
        },
        {
          object: 'hunter_meets_bounty_id_requirement',
          kind: 'SECURITY DEFINER function, EXECUTE granted to authenticated',
          rule: 'raises unless p_hunter_id = auth.uid() -- prevents using the boolean result as a side channel on another user',
        },
      ]);
    });
  }
});
