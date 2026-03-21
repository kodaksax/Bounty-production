import { withStripeIdempotency } from '../services/stripe-safeguards';
import * as idempotency from '../services/idempotency-service';

jest.mock('../services/idempotency-service');

describe('stripe-safeguards', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('throws on duplicate idempotency key', async () => {
    (idempotency.checkIdempotencyKey as jest.Mock).mockResolvedValue(true);

    await expect(withStripeIdempotency('dup_key', async () => ({ ok: true }))).rejects.toThrow('Duplicate idempotency key');
    expect(idempotency.checkIdempotencyKey).toHaveBeenCalledWith('dup_key');
  });

  test('stores key and calls function then removes on error', async () => {
    (idempotency.checkIdempotencyKey as jest.Mock).mockResolvedValue(false);
    (idempotency.storeIdempotencyKey as jest.Mock).mockResolvedValue(undefined);
    (idempotency.removeIdempotencyKey as jest.Mock).mockResolvedValue(undefined);

    const fn = jest.fn().mockRejectedValue(new Error('stripe failure'));

    await expect(withStripeIdempotency('k1', fn)).rejects.toThrow('stripe failure');

    expect(idempotency.checkIdempotencyKey).toHaveBeenCalledWith('k1');
    expect(idempotency.storeIdempotencyKey).toHaveBeenCalledWith('k1', expect.any(Number));
    expect(idempotency.removeIdempotencyKey).toHaveBeenCalledWith('k1');
  });

  test('calls function and returns result on success', async () => {
    (idempotency.checkIdempotencyKey as jest.Mock).mockResolvedValue(false);
    (idempotency.storeIdempotencyKey as jest.Mock).mockResolvedValue(undefined);

    const fn = jest.fn().mockResolvedValue({ id: 'ok' });

    const res = await withStripeIdempotency('k2', fn);
    expect(res).toEqual({ id: 'ok' });
    expect(idempotency.storeIdempotencyKey).toHaveBeenCalledWith('k2', expect.any(Number));
  });
});
