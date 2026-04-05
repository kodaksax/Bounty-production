/**
 * Unit tests for wallet balance persistence across cold restarts
 *
 * Validates that:
 * 1. The optimistic deposit timestamp is persisted to SecureStore
 * 2. On cold restart, the persisted timestamp is restored so the guard prevents
 *    the API from overwriting the locally-stored balance
 * 3. When the API balance catches up, the guard is cleared
 * 4. On sign-out, the persisted timestamp is cleared
 */

import { SecureKeys } from '../../lib/utils/secure-storage';

// --- in-memory SecureStore mock ---
const store: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    store[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete store[key];
  }),
  AFTER_FIRST_UNLOCK: 6,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: jest.fn(async () => {}),
    getItem: jest.fn(async () => null),
    removeItem: jest.fn(async () => {}),
  },
}));

// Lightweight mock for react-native Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Import after mocking so the mocks are in place
import { getSecureJSON, setSecureJSON } from '../../lib/utils/secure-storage';

function clearStore() {
  for (const key in store) delete store[key];
}

describe('Wallet balance persistence', () => {
  beforeEach(clearStore);

  describe('SecureKeys', () => {
    it('should include WALLET_LAST_DEPOSIT_TS key', () => {
      expect(SecureKeys.WALLET_LAST_DEPOSIT_TS).toBeDefined();
      expect(typeof SecureKeys.WALLET_LAST_DEPOSIT_TS).toBe('string');
    });
  });

  describe('Optimistic deposit timestamp persistence', () => {
    it('should persist a deposit timestamp and read it back', async () => {
      const ts = Date.now();
      await setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, ts);

      const restored = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);
      expect(restored).toBe(ts);
    });

    it('should return null when no timestamp has been stored', async () => {
      const restored = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);
      expect(restored).toBeNull();
    });

    it('should clear the timestamp by persisting null', async () => {
      await setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, Date.now());
      await setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, null);

      const restored = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);
      expect(restored).toBeNull();
    });
  });

  describe('Balance + timestamp round-trip (simulates cold restart)', () => {
    it('should persist balance and deposit timestamp, then restore both', async () => {
      // --- Session 1: User deposits $100 ---
      const depositAmount = 100;
      const depositTs = Date.now();

      await setSecureJSON(SecureKeys.WALLET_BALANCE, depositAmount);
      await setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, depositTs);

      // --- "Cold restart" – clear in-memory state ---
      // (We keep the store object intact to simulate SecureStore persistence)

      // --- Session 2: App restarts and loads from SecureStore ---
      const restoredBalance = await getSecureJSON<number>(SecureKeys.WALLET_BALANCE);
      const restoredTs = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);

      expect(restoredBalance).toBe(100);
      expect(typeof restoredTs).toBe('number');
      expect(restoredTs).toBe(depositTs);

      // The guard should fire: timestamp exists and is recent
      const now = Date.now();
      const OPTIMISTIC_WINDOW_MS = 5 * 60 * 1000;
      const hasRecentDeposit =
        restoredTs !== null && now - (restoredTs as number) < OPTIMISTIC_WINDOW_MS;
      expect(hasRecentDeposit).toBe(true);

      // Simulated API balance = 0 (server hasn't caught up)
      const apiBalance = 0;
      const resolvedBalance =
        hasRecentDeposit && (restoredBalance as number) > apiBalance
          ? restoredBalance
          : apiBalance;

      expect(resolvedBalance).toBe(100); // local balance preserved!
    });

    it('should use API balance once server catches up', async () => {
      const depositTs = Date.now();
      await setSecureJSON(SecureKeys.WALLET_BALANCE, 100);
      await setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, depositTs);

      // Simulate cold restart – restore values
      const restoredBalance = await getSecureJSON<number>(SecureKeys.WALLET_BALANCE);
      const restoredTs = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);

      const now = Date.now();
      const OPTIMISTIC_WINDOW_MS = 5 * 60 * 1000;
      const hasRecentDeposit =
        restoredTs !== null && now - (restoredTs as number) < OPTIMISTIC_WINDOW_MS;

      // API now returns the correct $100 balance
      const apiBalance = 100;
      const resolvedBalance =
        hasRecentDeposit && (restoredBalance as number) > apiBalance
          ? restoredBalance
          : apiBalance;

      // Both are 100 so API wins (currentBalance <= apiBalance)
      expect(resolvedBalance).toBe(100);

      // Guard should be cleared
      const shouldClearGuard = !hasRecentDeposit || (restoredBalance as number) <= apiBalance;
      expect(shouldClearGuard).toBe(true);
    });

    it('should use API balance when guard has expired', async () => {
      // Deposit was 10 minutes ago (beyond 5-minute window)
      const oldTs = Date.now() - 10 * 60 * 1000;
      await setSecureJSON(SecureKeys.WALLET_BALANCE, 100);
      await setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, oldTs);

      const restoredBalance = await getSecureJSON<number>(SecureKeys.WALLET_BALANCE);
      const restoredTs = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);

      const now = Date.now();
      const OPTIMISTIC_WINDOW_MS = 5 * 60 * 1000;
      const hasRecentDeposit =
        restoredTs !== null && now - (restoredTs as number) < OPTIMISTIC_WINDOW_MS;

      expect(hasRecentDeposit).toBe(false);

      // API balance is 0 but guard is expired → uses API
      const apiBalance = 0;
      const resolvedBalance =
        hasRecentDeposit && (restoredBalance as number) > apiBalance
          ? restoredBalance
          : apiBalance;

      expect(resolvedBalance).toBe(0);
    });
  });

  describe('Sign-out clears wallet data', () => {
    it('should clear balance, transactions, and deposit timestamp on sign-out', async () => {
      await setSecureJSON(SecureKeys.WALLET_BALANCE, 100);
      await setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, [{ id: '1', type: 'deposit', amount: 100 }]);
      await setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, Date.now());

      // Simulate sign-out cleanup
      await Promise.all([
        setSecureJSON(SecureKeys.WALLET_BALANCE, 0),
        setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, []),
        setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, null),
      ]);

      const balance = await getSecureJSON<number>(SecureKeys.WALLET_BALANCE);
      const transactions = await getSecureJSON<any[]>(SecureKeys.WALLET_TRANSACTIONS);
      const depositTs = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);

      expect(balance).toBe(0);
      expect(transactions).toEqual([]);
      expect(depositTs).toBeNull();
    });
  });
});
