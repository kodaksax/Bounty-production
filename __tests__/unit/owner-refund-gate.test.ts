import {
  checkOwnerRefundGate,
  type OwnerRefundGateClient,
} from '../../supabase/functions/_shared/owner-refund-gate';

const BOUNTY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const POSTER = '11111111-1111-4111-8111-111111111111';

function client(result: { data?: unknown; error?: { message?: string; code?: string } | null; throws?: Error }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const c: OwnerRefundGateClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      if (result.throws) return Promise.reject(result.throws);
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
  return { c, calls };
}

describe('checkOwnerRefundGate', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks the database rule about this bounty and caller', async () => {
    const { c, calls } = client({ data: null });
    await checkOwnerRefundGate(c, BOUNTY, POSTER);
    expect(calls).toEqual([
      { fn: 'fn_owner_refund_block_reason', args: { p_bounty_id: BOUNTY, p_caller: POSTER } },
    ]);
  });

  it('allows the refund when the rule returns NULL (never accepted / hunter cancelled)', async () => {
    const { c } = client({ data: null });
    await expect(checkOwnerRefundGate(c, BOUNTY, POSTER)).resolves.toEqual({ ok: true });
  });

  it('blocks with 409 once a hunter is accepted', async () => {
    const { c } = client({ data: 'refund_requires_cancellation_or_dispute' });
    const result = await checkOwnerRefundGate(c, BOUNTY, POSTER);
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'refund_requires_cancellation_or_dispute',
      retryable: false,
    });
  });

  it('blocks with 409 while a dispute is open', async () => {
    const { c } = client({ data: 'refund_blocked_by_open_dispute' });
    await expect(checkOwnerRefundGate(c, BOUNTY, POSTER)).resolves.toMatchObject({
      ok: false,
      status: 409,
      code: 'refund_blocked_by_open_dispute',
    });
  });

  it('maps not_bounty_owner to 403', async () => {
    const { c } = client({ data: 'not_bounty_owner' });
    await expect(checkOwnerRefundGate(c, BOUNTY, POSTER)).resolves.toMatchObject({
      ok: false,
      status: 403,
      code: 'not_bounty_owner',
    });
  });

  it('treats an unknown reason as a block, never as permission', async () => {
    const { c } = client({ data: 'some_future_reason' });
    await expect(checkOwnerRefundGate(c, BOUNTY, POSTER)).resolves.toMatchObject({
      ok: false,
      status: 409,
      code: 'some_future_reason',
    });
  });

  it('fails closed when the RPC errors (e.g. migration not applied yet)', async () => {
    const { c } = client({
      error: { code: 'PGRST202', message: 'Could not find the function public.fn_owner_refund_block_reason' },
    });
    await expect(checkOwnerRefundGate(c, BOUNTY, POSTER)).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: 'refund_gate_unavailable',
      retryable: true,
    });
  });

  it('fails closed when the RPC throws', async () => {
    const { c } = client({ throws: new Error('network down') });
    await expect(checkOwnerRefundGate(c, BOUNTY, POSTER)).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: 'refund_gate_unavailable',
    });
  });
});
