import {
  resolvePostTimeEscrow,
  type PostTimeEscrowBountyRow,
} from '../../supabase/functions/_shared/post-time-escrow-guard';

const POSTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function bounty(overrides: Partial<PostTimeEscrowBountyRow> = {}): PostTimeEscrowBountyRow {
  return { funding_mode: 'at_post', poster_id: POSTER, user_id: POSTER, ...overrides };
}

describe('resolvePostTimeEscrow', () => {
  describe('pay-at-accept bounties are never debited at post time', () => {
    it('skips the debit for funding_mode=at_accept', () => {
      const result = resolvePostTimeEscrow({
        callerId: POSTER,
        bounty: bounty({ funding_mode: 'at_accept' }),
      });

      expect(result.action).toBe('skip');
    });

    it('reports the skip as the 409 duplicate_transaction shape legacy clients treat as success', () => {
      // A legacy bundle deletes the bounty it just created on any *unhandled*
      // escrow error. duplicate_transaction is the one code lib/wallet-context
      // already swallows, so a deferred post must not vanish.
      const result = resolvePostTimeEscrow({
        callerId: POSTER,
        bounty: bounty({ funding_mode: 'at_accept' }),
      });

      expect(result).toMatchObject({
        action: 'skip',
        status: 409,
        code: 'duplicate_transaction',
      });
    });

    it('skips when only the legacy user_id column identifies the poster', () => {
      const result = resolvePostTimeEscrow({
        callerId: POSTER,
        bounty: { funding_mode: 'at_accept', poster_id: null, user_id: POSTER },
      });

      expect(result.action).toBe('skip');
    });
  });

  describe('legacy at_post bounties are unaffected', () => {
    it('proceeds for funding_mode=at_post', () => {
      expect(resolvePostTimeEscrow({ callerId: POSTER, bounty: bounty() })).toEqual({
        action: 'proceed',
      });
    });

    it('proceeds when funding_mode is absent (pre-migration row shape)', () => {
      expect(
        resolvePostTimeEscrow({ callerId: POSTER, bounty: bounty({ funding_mode: null }) })
      ).toEqual({ action: 'proceed' });
    });
  });

  describe('the guard only ever removes a charge', () => {
    it('proceeds when the bounty row is missing', () => {
      expect(resolvePostTimeEscrow({ callerId: POSTER, bounty: null })).toEqual({
        action: 'proceed',
      });
    });

    it('proceeds when the lookup itself failed', () => {
      expect(
        resolvePostTimeEscrow({
          callerId: POSTER,
          bounty: bounty({ funding_mode: 'at_accept' }),
          lookupFailed: true,
        })
      ).toEqual({ action: 'proceed' });
    });
  });

  describe('ownership', () => {
    it('rejects a caller who does not own the bounty', () => {
      const result = resolvePostTimeEscrow({ callerId: OTHER, bounty: bounty() });

      expect(result).toMatchObject({
        action: 'reject',
        status: 403,
        code: 'not_bounty_owner',
      });
    });

    it('rejects a non-owner before disclosing the funding mode', () => {
      const result = resolvePostTimeEscrow({
        callerId: OTHER,
        bounty: bounty({ funding_mode: 'at_accept' }),
      });

      expect(result).toMatchObject({ action: 'reject', code: 'not_bounty_owner' });
    });

    it('proceeds when the row carries no owner columns at all', () => {
      expect(
        resolvePostTimeEscrow({
          callerId: POSTER,
          bounty: { funding_mode: 'at_post', poster_id: null, user_id: null },
        })
      ).toEqual({ action: 'proceed' });
    });
  });
});
