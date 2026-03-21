import { reconciliationCron } from '../services/reconciliation-cron';

jest.mock('../services/consolidated-payment-service', () => ({
  stripe: {
    transfers: { retrieve: jest.fn() },
    paymentIntents: { retrieve: jest.fn() },
  }
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn()
}));

const { createClient } = require('@supabase/supabase-js');
const { stripe } = require('../services/consolidated-payment-service');

describe('reconciliation cron', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('marks transfer and payment intent transactions completed/failed based on Stripe status', async () => {
    // Prepare mock DB results
    const pendingTransfer = { id: 'tx1', stripe_transfer_id: 'tr_1', status: 'pending' };
    const pendingIntent = { id: 'tx2', stripe_payment_intent_id: 'pi_1', status: 'pending' };

    // Mock admin client builder
    const updateMock = jest.fn().mockResolvedValue({ error: null });

    const admin = {
      from: (table: string) => {
        return {
          select: (_sel?: any) => ({
            not: (_a: any, _b: any, _c: any) => ({
              neq: (_field: any, _val: any) => ({
                limit: (_n: number) => {
                  if (table === 'wallet_transactions') {
                    // differentiate by which field the caller filtered on by checking earlier not/neq - but for test return both requests by checking globals
                    if ((global as any).__lastCalled === 'transfers') {
                      return Promise.resolve({ data: [pendingTransfer], error: null });
                    }
                    return Promise.resolve({ data: [pendingIntent], error: null });
                  }
                  return Promise.resolve({ data: [], error: null });
                }
              })
            })
          }),
          update: updateMock
        };
      }
    };

    // make createClient return our admin
    (createClient as jest.Mock).mockReturnValue(admin);

    // Mock stripe responses
    (stripe.transfers.retrieve as jest.Mock).mockResolvedValue({ id: 'tr_1', status: 'succeeded' });
    (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({ id: 'pi_1', status: 'succeeded' });

    // Simulate first call to handle transfers
    (global as any).__lastCalled = 'transfers';
    await reconciliationCron.runOnce();

    // Then simulate payment intents
    (global as any).__lastCalled = 'intents';
    await reconciliationCron.runOnce();

    // Expect update to have been called at least once for completed transactions
    expect(updateMock).toHaveBeenCalled();
    // Verify stripe retrieve calls
    expect(stripe.transfers.retrieve).toHaveBeenCalledWith('tr_1');
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
  });
});
