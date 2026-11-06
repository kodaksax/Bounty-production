/**
 * The client for accept-bounty-request: real function shapes in, supabase.rpc
 * shape out, so bountyRequestService.acceptRequest's mapping keeps working.
 */
const mockGetSession = jest.fn();
const mockRefreshSession = jest.fn();

jest.mock('lib/supabase', () => ({
  supabaseEnv: { url: 'https://proj.supabase.co/' },
  supabase: { auth: { getSession: mockGetSession, refreshSession: mockRefreshSession } },
}));
jest.mock('../../lib/services/stripe-internal', () => ({ getSupabaseAnonKey: () => 'anon-key' }));

import {
  invokeAcceptBountyRequest,
  parseAcceptEdgeResponse,
} from '../../lib/services/accept-request-edge';

const postgrest = (message: string, code = 'P0001') =>
  JSON.stringify({
    error: 'x',
    details: JSON.stringify({ code, message, details: null, hint: null }),
  });

describe('parseAcceptEdgeResponse', () => {
  it('returns the rows on success', () => {
    const rows = [{ bounty: {}, accepted_request: { id: 'r1' } }];
    expect(parseAcceptEdgeResponse(200, JSON.stringify({ success: true, data: rows }))).toEqual({
      data: rows,
      error: null,
    });
  });

  it.each([
    [402, 'insufficient_funds_for_escrow', '23514'],
    [402, 'bounty_not_funded', 'P0001'],
    [409, 'bounty_not_open', 'P0001'],
    [409, 'request_not_pending', 'P0001'],
    [404, 'bounty_not_found', 'P0001'],
    [403, 'account_suspended', '42501'],
    [404, 'Could not find the function public.fn_accept_bounty_request', 'PGRST202'],
  ])('passes the database reason through: %s %s', (status, message, code) => {
    expect(parseAcceptEdgeResponse(status, postgrest(message, code)).error).toMatchObject({
      message,
      code,
      status,
    });
  });

  it('a shortfall with no charge comes back as the reason that reopens the gate', () => {
    expect(
      parseAcceptEdgeResponse(402, postgrest('insufficient_funds_for_escrow', '23514')).error
    ).toMatchObject({ message: 'insufficient_funds_for_escrow', status: 402 });
  });

  it('uses the code when the function refused before the database', () => {
    const body = JSON.stringify({
      error: 'Payment required: your card could not be charged',
      code: 'card_charge_failed',
      fallback: 'top_up',
    });
    expect(parseAcceptEdgeResponse(402, body).error).toEqual({
      message: 'card_charge_failed',
      code: 'card_charge_failed',
      status: 402,
      fallback: 'top_up',
    });
  });

  it('keeps the plain ownership refusal, which the funding gate matches', () => {
    const body = JSON.stringify({ error: 'Forbidden: only the bounty poster can accept requests' });
    expect(parseAcceptEdgeResponse(403, body).error?.message).toContain('only the bounty poster');
  });

  it('treats a bare 404 as request_not_found', () => {
    expect(
      parseAcceptEdgeResponse(404, JSON.stringify({ error: 'Not Found' })).error?.message
    ).toBe('request_not_found');
  });

  it('survives a non-JSON gateway error', () => {
    expect(parseAcceptEdgeResponse(502, '<html>').error).toMatchObject({
      message: 'accept-bounty-request failed with 502',
      status: 502,
    });
  });
});

describe('invokeAcceptBountyRequest', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  const ok = (status: number, body: unknown) =>
    ({ status, text: async () => JSON.stringify(body) } as Response);

  it('posts with the caller token, and asks the function not to charge a card', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    const fetchMock = jest.fn().mockResolvedValue(ok(200, { success: true, data: [] }));
    global.fetch = fetchMock as any;

    await invokeAcceptBountyRequest('r1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/accept-bounty-request');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', apikey: 'anon-key' });
    expect(JSON.parse(init.body)).toEqual({ request_id: 'r1', allow_card_charge: false });
  });

  it('refreshes once on a 401', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'old' } } });
    mockRefreshSession.mockResolvedValue({ data: { session: { access_token: 'new' } } });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(ok(401, { error: 'Invalid or expired token' }))
      .mockResolvedValueOnce(ok(200, { success: true, data: [] }));
    global.fetch = fetchMock as any;

    await expect(invokeAcceptBountyRequest('r1')).resolves.toEqual({ data: [], error: null });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  it('reports no response as a network failure', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    global.fetch = jest.fn().mockRejectedValue(new Error('Request failed')) as any;

    const { error } = await invokeAcceptBountyRequest('r1');
    expect(error?.message).toMatch(/^network/);
  });
});
