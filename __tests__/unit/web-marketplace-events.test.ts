/**
 * Server-side canonical events for web flows (PostHog audit 2026-11-23):
 * web-checkout bounties sent no bounty_published, and hires / completion
 * approvals on the web poster page sent no application_accepted /
 * bounty_completed, so marketplace funnels undercounted the web.
 *
 * Pins each payload, the deterministic uuid, and that nothing is sent on a
 * failed or no-op path. The Deno handlers can't be imported by jest, so their
 * call sites are pinned by source contract at the bottom.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildWebApplicationAcceptedEvent,
  buildWebBountyCompletedEvent,
  buildWebBountyPublishedEvent,
  deterministicEventUuid,
  sendWebBountyPublished,
} from '../../supabase/functions/_shared/web-marketplace-events';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

const POSTER = '6f1c2a3b-0000-4000-8000-000000000001';
const HUNTER = '7a2d3c4e-0000-4000-8000-000000000002';
const BOUNTY = 'e97153e6-a212-4700-aa25-9bda1469bbce';
const REQUEST = '51afe058-1d50-42d6-98aa-482a6d667190';
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Independent RFC 4122 v5 implementation (Node crypto), to check ours. */
function referenceV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const NAMESPACE = '5d0c8f2e-6b1a-4c3e-9f47-2a8b3e6d1c90';

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('deterministicEventUuid', () => {
  it('is a valid v5 uuid matching an independent implementation', async () => {
    const id = await deterministicEventUuid(`bounty_published:${BOUNTY}`);
    expect(id).toMatch(UUID_V5);
    expect(id).toBe(referenceV5(`bounty_published:${BOUNTY}`, NAMESPACE));
  });

  it('is stable for a key and different across event names and ids', async () => {
    const a = await deterministicEventUuid(`bounty_published:${BOUNTY}`);
    expect(await deterministicEventUuid(`bounty_published:${BOUNTY}`)).toBe(a);
    expect(await deterministicEventUuid(`bounty_completed:${BOUNTY}`)).not.toBe(a);
    expect(await deterministicEventUuid(`bounty_published:${REQUEST}`)).not.toBe(a);
  });
});

describe('bounty_published (web checkout)', () => {
  const row = {
    id: BOUNTY,
    poster_id: POSTER,
    user_id: POSTER,
    amount: '60.00',
    category: 'labor',
    funding_mode: 'at_post',
    created_at: '2026-11-24T15:00:00.123+00:00',
  };

  it('is the poster, the row fields, surface web_checkout and the function as source', async () => {
    const e = await buildWebBountyPublishedEvent(row, 'webhooks');
    expect(e).toEqual({
      event: 'bounty_published',
      distinct_id: POSTER,
      uuid: await deterministicEventUuid(`bounty_published:${BOUNTY}`),
      timestamp: '2026-11-24T15:00:00.123Z',
      properties: {
        role: 'poster',
        bounty_id: BOUNTY,
        amount: 60,
        category: 'labor',
        funding_mode: 'at_post',
        surface: 'web_checkout',
        source: 'webhooks',
      },
    });
  });

  it('a held post confirmed on the page has the same uuid, so it can never count twice', async () => {
    const fromWebhook = await buildWebBountyPublishedEvent(row, 'webhooks');
    const fromPage = await buildWebBountyPublishedEvent(row, 'poster-web');
    expect(fromPage!.uuid).toBe(fromWebhook!.uuid);
    expect(fromPage!.properties.source).toBe('poster-web');
  });

  it('falls back to user_id, and is null with no owner or no id', async () => {
    expect((await buildWebBountyPublishedEvent({ ...row, poster_id: null }, 'webhooks'))!.distinct_id).toBe(POSTER);
    expect(await buildWebBountyPublishedEvent({ ...row, poster_id: null, user_id: null }, 'webhooks')).toBeNull();
    expect(await buildWebBountyPublishedEvent(null, 'webhooks')).toBeNull();
  });

  it('carries no title, description, location or email', async () => {
    const e = await buildWebBountyPublishedEvent(
      { ...row, title: 'Help move a couch', description: 'x', location: '1 Main St', email: 'a@b.c' } as any,
      'webhooks'
    );
    expect(Object.keys(e!.properties).sort()).toEqual(
      ['amount', 'bounty_id', 'category', 'funding_mode', 'role', 'source', 'surface'].sort()
    );
  });
});

describe('sendWebBountyPublished', () => {
  function fakeSupabase(result: { data: any; error: any } | Promise<never>) {
    const maybeSingle = jest.fn(() => result);
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    return { client: { from: jest.fn(() => ({ select })) }, select, eq };
  }
  const row = { id: BOUNTY, poster_id: POSTER, amount: 25, category: null, funding_mode: 'at_accept', created_at: null };

  it('first creation: reads the row back, then sends', async () => {
    const send = jest.fn();
    const db = fakeSupabase({ data: row, error: null });
    expect(await sendWebBountyPublished({ supabase: db.client, bountyId: BOUNTY, created: true, source: 'webhooks', send })).toBe('sent');
    expect(db.client.from).toHaveBeenCalledWith('bounties');
    expect(db.eq).toHaveBeenCalledWith('id', BOUNTY);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].properties.bounty_id).toBe(BOUNTY);
  });

  it.each([
    ['a replay', false],
    ['an unknown result', undefined],
    ['a truthy non-boolean', 'true'],
  ])('%s sends nothing and reads nothing', async (_label, created) => {
    const send = jest.fn();
    const db = fakeSupabase({ data: row, error: null });
    expect(await sendWebBountyPublished({ supabase: db.client, bountyId: BOUNTY, created, source: 'webhooks', send })).toBe('skipped');
    expect(db.client.from).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('no bounty id sends nothing', async () => {
    const send = jest.fn();
    const db = fakeSupabase({ data: row, error: null });
    expect(await sendWebBountyPublished({ supabase: db.client, bountyId: null, created: true, source: 'webhooks', send })).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('a row that is not there, or a read error, sends nothing and does not throw', async () => {
    const send = jest.fn();
    for (const result of [{ data: null, error: null }, { data: null, error: { code: '57014' } }]) {
      const db = fakeSupabase(result);
      expect(await sendWebBountyPublished({ supabase: db.client, bountyId: BOUNTY, created: true, source: 'webhooks', send })).toBe('error');
    }
    const throwing = fakeSupabase(Promise.reject(new Error('boom')) as Promise<never>);
    expect(await sendWebBountyPublished({ supabase: throwing.client, bountyId: BOUNTY, created: true, source: 'webhooks', send })).toBe('error');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('application_accepted (web poster page)', () => {
  const bounty = { id: BOUNTY, amount: '80.00', is_for_honor: false };
  const request = { id: REQUEST, status: 'accepted', hunter_id: HUNTER };

  it("uses the app's property names, the poster as distinct_id and a uuid from the request id", async () => {
    const e = await buildWebApplicationAcceptedEvent({ outcome: 'accepted', posterId: POSTER, bounty, request });
    expect(e).toEqual({
      event: 'application_accepted',
      distinct_id: POSTER,
      uuid: await deterministicEventUuid(`application_accepted:${REQUEST}`),
      properties: {
        role: 'poster',
        bounty_id: BOUNTY,
        application_id: REQUEST,
        hunter_id: HUNTER,
        is_for_honor: false,
        amount: 80,
        surface: 'web_poster_page',
        source: 'poster-web',
      },
    });
  });

  it('matches the keys hooks/useAcceptRequest.ts sends', () => {
    const hook = read('hooks/useAcceptRequest.ts');
    for (const key of ['role:', 'bounty_id:', 'application_id:', 'hunter_id:', 'is_for_honor:', 'amount:']) {
      expect(hook).toContain(key);
    }
  });

  it.each(['already_accepted', 'assigned_to_other', 'bounty_closed', 'request_closed', 'card_failed', 'not_funded', 'retry', 'not_found'])(
    'outcome %s sends nothing',
    async (outcome) => {
      expect(await buildWebApplicationAcceptedEvent({ outcome, posterId: POSTER, bounty, request })).toBeNull();
    }
  );

  it('no request row sends nothing', async () => {
    expect(await buildWebApplicationAcceptedEvent({ outcome: 'accepted', posterId: POSTER, bounty, request: null })).toBeNull();
  });
});

describe('bounty_completed (web confirm)', () => {
  const bounty = { id: BOUNTY, amount: 60, is_for_honor: false };

  it('only when this call completed the bounty', async () => {
    const e = await buildWebBountyCompletedEvent({
      completedByThisCall: true,
      posterId: POSTER,
      bounty,
      completedAt: '2026-11-24T16:00:00.000Z',
    });
    expect(e).toEqual({
      event: 'bounty_completed',
      distinct_id: POSTER,
      uuid: await deterministicEventUuid(`bounty_completed:${BOUNTY}`),
      timestamp: '2026-11-24T16:00:00.000Z',
      properties: {
        bounty_id: BOUNTY,
        amount: 60,
        isForHonor: false,
        via: 'web_confirm',
        surface: 'web_poster_page',
        source: 'poster-web',
      },
    });
    expect(await buildWebBountyCompletedEvent({ completedByThisCall: false, posterId: POSTER, bounty })).toBeNull();
  });
});

describe('capture helper (posthog-capture.ts)', () => {
  const g = globalThis as any;
  let fetchMock: jest.Mock;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = {
      POSTHOG_PROJECT_API_KEY: 'phc_test',
      SUPABASE_URL: 'https://xwlwqzzphmmhghiqvkeu.supabase.co',
    };
    g.Deno = { env: { get: (k: string) => env[k] } };
    // AbortSignal.timeout starts a real Node timer that outlives the test.
    jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
    fetchMock = jest.fn(() => Promise.resolve({ ok: true }));
    g.fetch = fetchMock;
  });
  afterEach(() => {
    delete g.Deno;
  });

  const load = () => require('../../supabase/functions/_shared/posthog-capture');
  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it('stays backward compatible: three arguments, no uuid or timestamp sent', () => {
    load().capture(POSTER, 'web_held_post_decision', { decision: 'decline' });
    const b = body();
    expect(b.uuid).toBeUndefined();
    expect(b.timestamp).toBeUndefined();
    expect(b.properties).toEqual({
      distinct_id: POSTER,
      platform: 'web',
      app_env: 'production',
      source: 'poster-web',
      decision: 'decline',
    });
  });

  it('sends the uuid and timestamp at the top level when given', () => {
    load().capture(POSTER, 'bounty_published', { source: 'webhooks' }, { uuid: 'u-1', timestamp: '2026-11-24T00:00:00.000Z' });
    expect(body()).toMatchObject({ uuid: 'u-1', timestamp: '2026-11-24T00:00:00.000Z', event: 'bounty_published' });
    expect(body().properties.source).toBe('webhooks');
  });

  it('app_env comes from resolveAppEnv, not a hard-coded production', () => {
    env.SUPABASE_URL = 'https://staging-ref.supabase.co';
    load().capture(POSTER, 'x', {});
    expect(body().properties.app_env).toBe('staging');
    fetchMock.mockClear();
    env.APP_ENV = 'development';
    load().capture(POSTER, 'x', {});
    expect(body().properties.app_env).toBe('development');
  });

  it('sendServerEvent passes the built event through', async () => {
    const e = await buildWebBountyCompletedEvent({ completedByThisCall: true, posterId: POSTER, bounty: { id: BOUNTY, amount: 5 } });
    load().sendServerEvent(e);
    expect(body()).toMatchObject({ event: 'bounty_completed', uuid: e!.uuid });
    expect(body().properties).toMatchObject({ distinct_id: POSTER, via: 'web_confirm', source: 'poster-web' });
  });

  it('no API key: sends nothing', () => {
    env.POSTHOG_PROJECT_API_KEY = undefined;
    load().capture(POSTER, 'x', {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('support-cases.ts no longer hard-codes app_env and re-exports the helper', () => {
    const src = read('supabase/functions/_shared/support-cases.ts');
    expect(src).not.toMatch(/app_env:\s*'production'/);
    expect(src).toMatch(/export \{ capture, sendServerEvent \} from '\.\/posthog-capture\.ts'/);
  });
});

describe('call sites (source contract)', () => {
  const posterWeb = read('supabase/functions/poster-web/index.ts');
  const webhooks = read('supabase/functions/webhooks/index.ts');
  const deferred = read('supabase/functions/webhooks/deferred-bounty-setup.ts');

  const between = (src: string, start: string, end: string) => {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i + start.length);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    return src.slice(i, j);
  };

  it('webhooks (payment mode): after the RPC succeeded, first creation only', () => {
    const block = between(webhooks, "'fn_create_bounty_from_pending',", 'default:');
    const rpcFail = block.indexOf('throw rpcErr');
    const send = block.indexOf('sendWebBountyPublished(');
    expect(rpcFail).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(rpcFail);
    expect(block).toMatch(/created: created\?\.created,\s*source: 'webhooks'/);
  });

  it('webhooks (setup mode): the sender is passed to the deferred handler', () => {
    expect(webhooks).toMatch(/handleDeferredBountySetup\(\{[\s\S]*?sendEvent: sendServerEvent,[\s\S]*?\}\)/);
    const tail = deferred.slice(deferred.indexOf("supabase.rpc('fn_create_bounty_from_pending_deferred'"));
    expect(tail.indexOf('sendWebBountyPublished(')).toBeGreaterThan(tail.indexOf('throw rpcErr'));
  });

  it('poster-web held post: only when the RPC created the bounty now', () => {
    const block = between(posterWeb, "rpc('fn_claim_pending_bounties'", "seg[2] === 'decline'");
    expect(block).toMatch(/created: result\.outcome === 'posted'/);
    expect(block).toMatch(/source: 'poster-web'/);
  });

  it('poster-web accept: inside the accepted branch only, keeping the web diagnostic', () => {
    const block = between(posterWeb, "if (result.outcome === 'accepted') {", "return reply({ ...result, bounty_id: owned.id }");
    expect(block).toContain("'web_applicant_decision_completed'");
    expect(block).toContain('buildWebApplicationAcceptedEvent(');
    expect(posterWeb.match(/buildWebApplicationAcceptedEvent\(/g)).toHaveLength(1);
  });

  it('poster-web completion: honor after its guarded update; paid only from rows this update moved', () => {
    const honor = between(posterWeb, 'if (bounty.is_for_honor) {', '// 2. Release');
    expect(honor.indexOf('buildWebBountyCompletedEvent(')).toBeGreaterThan(honor.indexOf('if (completeErr || !completed?.length)'));
    const paid = between(posterWeb, "if (result.outcome === 'paid') {", 'let caseId');
    expect(paid).toMatch(/\.eq\('status', 'in_progress'\)\s*\.select\('id'\)/);
    expect(paid).toMatch(/completedByThisCall: !completeErr && \(completedRows \?\? \[\]\)\.length > 0/);
    expect(posterWeb.match(/buildWebBountyCompletedEvent\(/g)).toHaveLength(2);
  });
});
