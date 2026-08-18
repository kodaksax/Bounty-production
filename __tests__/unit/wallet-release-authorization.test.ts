import {
  authorizeRelease,
  resolveReleasePayee,
  type ReleaseBountyDetails,
  type ReleaseBountyLookupClient,
} from '../../supabase/functions/_shared/release-authorization';

const POSTER = '11111111-1111-4111-8111-111111111111';
const HUNTER = '22222222-2222-4222-8222-222222222222';
const ATTACKER = '33333333-3333-4333-8333-333333333333';

/**
 * Fake admin client that records every call, so a test can assert that a
 * rejected release performed no write. Any method other than the bounty lookup
 * is treated as a write attempt and recorded.
 */
function createLookupClient(options: {
  bounty?: ReleaseBountyDetails | null;
  error?: { message: string } | null;
}) {
  const calls = {
    selectedColumns: [] as string[],
    tables: [] as string[],
    writes: [] as string[],
  };

  const client = {
    from(table: string) {
      calls.tables.push(table);
      return {
        select(columns: string) {
          calls.selectedColumns.push(columns);
          return {
            eq(_column: string, _value: string) {
              return {
                single: async () => ({
                  data: options.error ? null : (options.bounty ?? null),
                  error: options.error ?? null,
                }),
              };
            },
          };
        },
        // Present only so an accidental write during the gate is caught rather
        // than throwing a confusing "not a function" error.
        insert(..._args: unknown[]) {
          calls.writes.push(`insert:${table}`);
          throw new Error('unexpected write during authorization');
        },
        update(..._args: unknown[]) {
          calls.writes.push(`update:${table}`);
          throw new Error('unexpected write during authorization');
        },
        delete(..._args: unknown[]) {
          calls.writes.push(`delete:${table}`);
          throw new Error('unexpected write during authorization');
        },
      };
    },
    rpc(name: string, ..._args: unknown[]) {
      calls.writes.push(`rpc:${name}`);
      throw new Error('unexpected RPC during authorization');
    },
  };

  return { client: client as unknown as ReleaseBountyLookupClient, calls };
}

describe('authorizeRelease — escrow payee cannot be chosen by the caller', () => {
  const bounty: ReleaseBountyDetails = { user_id: POSTER, accepted_by: HUNTER };

  it('pays the accepted hunter when the poster asserts the correct hunter', () => {
    const result = authorizeRelease({
      callerId: POSTER,
      requestedHunterId: HUNTER,
      bounty,
    });
    expect(result).toEqual({ ok: true, hunterId: HUNTER });
  });

  it('refuses to redirect escrow to an account that did not claim the bounty', () => {
    const result = authorizeRelease({
      callerId: POSTER,
      requestedHunterId: ATTACKER,
      bounty,
    });
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Requested hunter is not the accepted hunter for this bounty',
      code: 'hunter_mismatch',
    });
  });

  it('derives the payee from accepted_by when the body omits hunterId entirely', () => {
    expect(authorizeRelease({ callerId: POSTER, bounty })).toEqual({
      ok: true,
      hunterId: HUNTER,
    });
    expect(
      authorizeRelease({ callerId: POSTER, requestedHunterId: '', bounty })
    ).toEqual({ ok: true, hunterId: HUNTER });
    expect(
      authorizeRelease({ callerId: POSTER, requestedHunterId: null, bounty })
    ).toEqual({ ok: true, hunterId: HUNTER });
  });

  it('rejects a bounty with no accepted hunter instead of falling through', () => {
    const result = authorizeRelease({
      callerId: POSTER,
      requestedHunterId: HUNTER,
      bounty: { user_id: POSTER, accepted_by: null },
    });
    expect(result).toMatchObject({ ok: false, status: 409, code: 'no_accepted_hunter' });
  });

  it('does not phrase the no-hunter 409 in words the client reads as success', () => {
    const result = authorizeRelease({
      callerId: POSTER,
      bounty: { user_id: POSTER, accepted_by: null },
    });
    // lib/wallet-context.tsx treats a 409 matching /already (released|refunded)/
    // or /duplicate/ as an idempotent success. This failure must not match.
    const message = (result as { error: string }).error;
    expect(message).not.toMatch(/already (released|refunded)/i);
    expect(message).not.toMatch(/duplicate/i);
  });

  it('rejects a malformed hunterId before it can reach a query', () => {
    for (const malformed of ['not-a-uuid', '1234', "' OR 1=1 --", `${HUNTER}x`]) {
      expect(
        authorizeRelease({ callerId: POSTER, requestedHunterId: malformed, bounty })
      ).toMatchObject({ ok: false, status: 400, code: 'invalid_hunter_id' });
    }
  });

  it('rejects a non-string hunterId rather than coercing it', () => {
    for (const malformed of [42, {}, [], true]) {
      expect(
        authorizeRelease({ callerId: POSTER, requestedHunterId: malformed, bounty })
      ).toMatchObject({ ok: false, status: 400, code: 'invalid_hunter_id' });
    }
  });

  it('rejects a caller who does not own the bounty, with a distinct code', () => {
    const result = authorizeRelease({
      callerId: ATTACKER,
      requestedHunterId: HUNTER,
      bounty,
    });
    expect(result).toMatchObject({ ok: false, status: 403, code: 'not_bounty_owner' });
  });

  it('separates the two 403s so an attempted redirect is distinguishable in logs', () => {
    const wrongCaller = authorizeRelease({ callerId: ATTACKER, bounty });
    const wrongPayee = authorizeRelease({
      callerId: POSTER,
      requestedHunterId: ATTACKER,
      bounty,
    });
    expect(wrongCaller).toMatchObject({ status: 403, code: 'not_bounty_owner' });
    expect(wrongPayee).toMatchObject({ status: 403, code: 'hunter_mismatch' });
    expect((wrongCaller as { code: string }).code).not.toBe(
      (wrongPayee as { code: string }).code
    );
  });

  it('checks ownership before disclosing anything about who claimed the bounty', () => {
    // A non-owner gets the same answer whether or not a hunter exists.
    const withHunter = authorizeRelease({ callerId: ATTACKER, bounty });
    const withoutHunter = authorizeRelease({
      callerId: ATTACKER,
      bounty: { user_id: POSTER, accepted_by: null },
    });
    expect(withHunter).toEqual(withoutHunter);
  });

  it('treats a bounty with no owner as unreleasable', () => {
    expect(
      authorizeRelease({
        callerId: POSTER,
        bounty: { user_id: null, accepted_by: HUNTER },
      })
    ).toMatchObject({ ok: false, status: 403, code: 'not_bounty_owner' });
  });
});

describe('resolveReleasePayee — the gate in front of every release write', () => {
  it('selects accepted_by, without which the check cannot be made', async () => {
    const { client, calls } = createLookupClient({
      bounty: { user_id: POSTER, accepted_by: HUNTER },
    });

    await resolveReleasePayee(client, { bountyId: 'b-1', callerId: POSTER });

    expect(calls.tables).toEqual(['bounties']);
    expect(calls.selectedColumns[0]).toContain('accepted_by');
  });

  it('resolves the accepted hunter and the poster for a valid release', async () => {
    const { client } = createLookupClient({
      bounty: { user_id: POSTER, accepted_by: HUNTER, amount: 50, is_for_honor: false },
    });

    const result = await resolveReleasePayee(client, {
      bountyId: 'b-1',
      callerId: POSTER,
      requestedHunterId: HUNTER,
    });

    expect(result).toMatchObject({ ok: true, hunterId: HUNTER, posterId: POSTER });
    expect((result as { bounty: ReleaseBountyDetails }).bounty.amount).toBe(50);
  });

  it('writes nothing when the requested payee is not the accepted hunter', async () => {
    const { client, calls } = createLookupClient({
      bounty: { user_id: POSTER, accepted_by: HUNTER },
    });

    const result = await resolveReleasePayee(client, {
      bountyId: 'b-1',
      callerId: POSTER,
      requestedHunterId: ATTACKER,
    });

    expect(result).toMatchObject({ ok: false, status: 403, code: 'hunter_mismatch' });
    expect(calls.writes).toEqual([]);
  });

  it('writes nothing when the bounty has no accepted hunter', async () => {
    const { client, calls } = createLookupClient({
      bounty: { user_id: POSTER, accepted_by: null },
    });

    const result = await resolveReleasePayee(client, {
      bountyId: 'b-1',
      callerId: POSTER,
      requestedHunterId: HUNTER,
    });

    expect(result).toMatchObject({ ok: false, status: 409, code: 'no_accepted_hunter' });
    expect(calls.writes).toEqual([]);
  });

  it('writes nothing when hunterId is malformed', async () => {
    const { client, calls } = createLookupClient({
      bounty: { user_id: POSTER, accepted_by: HUNTER },
    });

    const result = await resolveReleasePayee(client, {
      bountyId: 'b-1',
      callerId: POSTER,
      requestedHunterId: 'not-a-uuid',
    });

    expect(result).toMatchObject({ ok: false, status: 400, code: 'invalid_hunter_id' });
    expect(calls.writes).toEqual([]);
  });

  it('reports a missing bounty as 404 without writing', async () => {
    const { client, calls } = createLookupClient({ bounty: null });

    const result = await resolveReleasePayee(client, { bountyId: 'nope', callerId: POSTER });

    expect(result).toMatchObject({ ok: false, status: 404, code: 'bounty_not_found' });
    expect(calls.writes).toEqual([]);
  });

  it('treats a lookup error as not-found rather than proceeding', async () => {
    const { client, calls } = createLookupClient({ error: { message: 'connection reset' } });

    const result = await resolveReleasePayee(client, { bountyId: 'b-1', callerId: POSTER });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(calls.writes).toEqual([]);
  });
});
