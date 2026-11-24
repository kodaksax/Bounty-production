/**
 * The remembered top-up (lib/services/unresolved-deposit): kept per user on
 * the device and cleared only by a definite answer from the server.
 */
const mockStore = new Map<string, string>();
let mockUser: string | null = 'u1';
jest.mock('lib/storage', () => ({
  storage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  },
}));
jest.mock('lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser }, access_token: 't' } : null } }) },
  },
}));
jest.mock('lib/config/api', () => ({ API_BASE_URL: 'https://api.test' }));
jest.mock('lib/config', () => ({ config: { supabase: { anonKey: 'k' } } }));
jest.mock('lib/utils/error-logger', () => ({ logger: { warning: jest.fn() } }));

import {
  ABANDONED_AUTH_MS,
  loadUnresolvedDeposit,
  reconcileUnresolvedDeposit,
  resetUnresolvedDepositMemory,
  saveUnresolvedDeposit,
} from '../../../lib/services/unresolved-deposit';

const PAY = { paymentIntentId: 'pi_abcdefgh', amount: 30, bountyId: 'b1', hunterName: 'Ada' };
const mockFetch = jest.fn();
const answer = (status: number, code?: string) =>
  mockFetch.mockResolvedValue({ ok: status < 400, status, json: async () => ({ code }) });

const realFetch = global.fetch;
beforeEach(() => {
  mockStore.clear();
  mockUser = 'u1';
  resetUnresolvedDepositMemory();
  mockFetch.mockReset();
  (global as any).fetch = mockFetch;
});
afterAll(() => {
  (global as any).fetch = realFetch;
});

it('survives an app restart, for the same user only', async () => {
  await saveUnresolvedDeposit(PAY);
  resetUnresolvedDepositMemory();
  expect(await loadUnresolvedDeposit()).toMatchObject(PAY);
  mockUser = 'u2';
  expect(await loadUnresolvedDeposit()).toBeNull();
});

it('still guards this session when the user cannot be read', async () => {
  mockUser = null;
  await saveUnresolvedDeposit(PAY);
  expect(await loadUnresolvedDeposit()).toMatchObject(PAY);
});

it.each([
  ['credited', 200, undefined],
  ['not_charged', 409, 'status_requires_payment_method'],
  ['not_charged', 409, 'status_canceled'],
])('%s (%s %s) clears it', async (verdict, status, code) => {
  await saveUnresolvedDeposit(PAY);
  const record = (await loadUnresolvedDeposit())!;
  answer(status as number, code);
  expect(await reconcileUnresolvedDeposit(record)).toBe(verdict);
  expect(await loadUnresolvedDeposit()).toBeNull();
  resetUnresolvedDepositMemory();
  expect(await loadUnresolvedDeposit()).toBeNull();
});

it.each([
  [409, 'status_processing'],
  [409, 'status_requires_capture'],
  [409, 'status_requires_action'],
  [403, 'user_mismatch'],
  [404, 'payment_intent_not_found'],
  [401, undefined],
  [500, 'deposit_record_failed'],
  [502, 'payment_verification_failed'],
])('%s %s keeps it', async (status, code) => {
  await saveUnresolvedDeposit(PAY);
  answer(status as number, code);
  expect(await reconcileUnresolvedDeposit((await loadUnresolvedDeposit())!)).toBe('pending');
  expect(await loadUnresolvedDeposit()).toMatchObject(PAY);
});

it('being offline keeps it', async () => {
  await saveUnresolvedDeposit(PAY);
  mockFetch.mockRejectedValue(new Error('offline'));
  expect(await reconcileUnresolvedDeposit((await loadUnresolvedDeposit())!)).toBe('pending');
  expect(await loadUnresolvedDeposit()).toMatchObject(PAY);
});

it('an abandoned bank check is released after an hour; a processing payment never is', async () => {
  await saveUnresolvedDeposit(PAY);
  const record = (await loadUnresolvedDeposit())!;
  const later = new Date(record.savedAt).getTime() + ABANDONED_AUTH_MS * 48;
  answer(409, 'status_processing');
  expect(await reconcileUnresolvedDeposit(record, later)).toBe('pending');
  answer(409, 'status_requires_action');
  expect(await reconcileUnresolvedDeposit(record, later)).toBe('not_charged');
});

it('an old answer never clears a newer payment', async () => {
  await saveUnresolvedDeposit(PAY);
  const old = (await loadUnresolvedDeposit())!;
  await saveUnresolvedDeposit({ ...PAY, paymentIntentId: 'pi_newerone' });
  answer(200);
  await reconcileUnresolvedDeposit(old);
  expect(await loadUnresolvedDeposit()).toMatchObject({ paymentIntentId: 'pi_newerone' });
});
