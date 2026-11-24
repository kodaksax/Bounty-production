/**
 * useWalletDeposit under a double tap (Add Money, and the hire sheet's pay
 * buttons, both charge through this hook).
 *
 * Root cause: `isProcessing` is React state, so the pay button is disabled a
 * render late. createPaymentIntentSecure's own duplicate check is released as
 * soon as the PaymentIntent is created, before it is confirmed, so a second
 * tap during confirmation (3DS, slow network) could create and confirm a
 * second PaymentIntent: a double charge. The hook now holds a synchronous
 * lock across all three payment methods.
 */
import { act, renderHook } from '@testing-library/react-native';

const mockProcessPaymentSecure = jest.fn();
const mockDeposit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../lib/stripe-context', () => ({
  useStripe: () => ({
    processPaymentSecure: (...a: unknown[]) => mockProcessPaymentSecure(...a),
    paymentMethods: [{ id: 'pm_1', type: 'card', card: { brand: 'visa', last4: '4242' } }],
    isLoading: false,
    error: null,
    loadPaymentMethods: jest.fn(),
  }),
}));
jest.mock('../../../lib/wallet-context', () => ({
  useWallet: () => ({ deposit: mockDeposit, refreshFromApi: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { access_token: 'tok', user: { id: 'u1' } } }),
}));
jest.mock('../../../lib/services/apple-pay-service', () => ({
  applePayService: { isAvailable: jest.fn().mockResolvedValue(false) },
}));
jest.mock('../../../lib/services/stripe-service', () => ({
  stripeService: { isGooglePayAvailable: jest.fn().mockResolvedValue(false) },
}));
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useWalletDeposit } = require('../../../hooks/use-wallet-deposit');

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockProcessPaymentSecure.mockReset();
  // persistDeposit posts to the API; a failed fetch is tolerated by the hook.
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

test('a double tap on Pay confirms one payment; both taps get its outcome', async () => {
  const payment = deferred<{ success: boolean; failure?: unknown }>();
  mockProcessPaymentSecure.mockReturnValue(payment.promise);
  const { result } = renderHook(() => useWalletDeposit());

  let first!: Promise<unknown>;
  let second!: Promise<unknown>;
  act(() => {
    first = result.current.payWithCard(25);
    second = result.current.payWithCard(25);
  });
  expect(mockProcessPaymentSecure).toHaveBeenCalledTimes(1);

  await act(async () => {
    payment.resolve({ success: false, failure: { failure_code: 'card_declined' } });
  });
  const [a, b] = await Promise.all([first, second]);
  expect(a).toEqual(b);
});

test('a second method tapped while a charge is in flight does not start another', async () => {
  const payment = deferred<{ success: boolean }>();
  mockProcessPaymentSecure.mockReturnValue(payment.promise);
  const { result } = renderHook(() => useWalletDeposit());

  act(() => {
    void result.current.payWithCard(25);
    void result.current.payWithApplePay(25);
    void result.current.payWithPaymentSheet(25);
  });
  expect(mockProcessPaymentSecure).toHaveBeenCalledTimes(1);

  await act(async () => {
    payment.resolve({ success: false });
  });
});

test('after a failed charge the user can pay again', async () => {
  mockProcessPaymentSecure
    .mockResolvedValueOnce({ success: false, failure: { failure_code: 'card_declined' } })
    .mockResolvedValueOnce({ success: false, failure: { failure_code: 'card_declined' } });
  const { result } = renderHook(() => useWalletDeposit());

  await act(async () => {
    await result.current.payWithCard(25);
  });
  await act(async () => {
    await result.current.payWithCard(25);
  });
  expect(mockProcessPaymentSecure).toHaveBeenCalledTimes(2);
});
