/**
 * Arm assignment for the $1 posting-fee experiment
 * (lib/experiments/posting-fee-variant.ts).
 *
 * The properties under test are the ones the rollout depends on. This arm
 * takes money, so an unstable assignment is not a measurement problem — it is
 * a poster being charged for a flow they were told was free, or being shown a
 * free flow after they have already paid.
 *
 *   * a resolved arm is PERSISTED, so a flag-config change or a PostHog
 *     outage cannot move a user who has already seen one arm
 *   * flags that never arrive resolve to CONTROL and are NOT persisted, so the
 *     device stays enrollable but is never charged on a guess
 *   * the arm is stamped as a person property, which is what makes the
 *     post-publish half of the funnel (acceptance, escrow, completion)
 *     attributable without instrumenting those paths
 */

const mockGetFeatureFlag = jest.fn();
const mockOnFeatureFlags = jest.fn(() => () => {});
const mockSetPersonProperties = jest.fn();

jest.mock('../../../lib/posthog', () => ({
  getFeatureFlag: (...args: unknown[]) => mockGetFeatureFlag(...args),
  onFeatureFlags: (...args: unknown[]) => mockOnFeatureFlags(...args),
  setPersonProperties: (...args: unknown[]) => mockSetPersonProperties(...args),
}));

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStorage.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      mockStorage.set(k, v);
      return Promise.resolve();
    }),
  },
}));

import {
  POSTING_FEE_FLAG_KEY,
  resolvePostingFeeVariant,
  __resetPostingFeeVariantCacheForTests,
} from '../../../lib/experiments/posting-fee-variant';

const STORAGE_KEY = '@bounty_posting_fee_variant';

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockOnFeatureFlags.mockImplementation(() => () => {});
  mockSetPersonProperties.mockImplementation(() => {});
  __resetPostingFeeVariantCacheForTests();
});

// Restored unconditionally. A test that installs fake timers and then times
// out would otherwise leak them into every suite that follows, which is how a
// single failure here cascaded into three.
afterEach(() => {
  jest.useRealTimers();
});

describe('flag -> arm mapping', () => {
  it("maps PostHog 'test' to the paid arm", async () => {
    mockGetFeatureFlag.mockReturnValue('test');
    await expect(resolvePostingFeeVariant()).resolves.toBe('fee');
    expect(mockGetFeatureFlag).toHaveBeenCalledWith(POSTING_FEE_FLAG_KEY);
  });

  it("maps PostHog 'control' to control", async () => {
    mockGetFeatureFlag.mockReturnValue('control');
    await expect(resolvePostingFeeVariant()).resolves.toBe('control');
  });

  it('maps a disabled flag (false) to control — the 80% of the rollout', async () => {
    mockGetFeatureFlag.mockReturnValue(false);
    await expect(resolvePostingFeeVariant()).resolves.toBe('control');
  });

  it('maps an unrecognised variant key to control rather than guessing', async () => {
    mockGetFeatureFlag.mockReturnValue('some-future-arm');
    await expect(resolvePostingFeeVariant()).resolves.toBe('control');
  });
});

describe('stability across sessions', () => {
  it('persists the resolved arm so a later launch cannot re-roll it', async () => {
    mockGetFeatureFlag.mockReturnValue('test');
    await expect(resolvePostingFeeVariant()).resolves.toBe('fee');
    expect(mockStorage.get(STORAGE_KEY)).toBe('fee');
  });

  it('prefers the persisted arm over a changed flag value', async () => {
    mockStorage.set(STORAGE_KEY, 'fee');
    // The flag now says control — e.g. the rollout was reduced. A poster who
    // has already been in the paid arm must not silently move.
    mockGetFeatureFlag.mockReturnValue('control');

    await expect(resolvePostingFeeVariant()).resolves.toBe('fee');
    // The flag is not even consulted once a persisted arm exists.
    expect(mockGetFeatureFlag).not.toHaveBeenCalled();
  });

  it('returns the same arm on repeated resolution within a session', async () => {
    mockGetFeatureFlag.mockReturnValue('test');
    const first = await resolvePostingFeeVariant();
    const second = await resolvePostingFeeVariant();
    expect(first).toBe(second);
  });
});

describe('flags unavailable', () => {
  it('falls back to control WITHOUT persisting, so the device stays enrollable', async () => {
    // getFeatureFlag returns undefined and no flags callback ever fires.
    mockGetFeatureFlag.mockReturnValue(undefined);
    mockOnFeatureFlags.mockImplementation(() => () => {});

    // advanceTimersByTimeAsync, not advanceTimersByTime: resolution first
    // awaits AsyncStorage, so the 400 ms fallback timer is not registered yet
    // when this line runs. The async variant flushes those microtasks between
    // ticks; the sync one advances a clock with no timer on it and hangs.
    jest.useFakeTimers();
    const pending = resolvePostingFeeVariant();
    await jest.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe('control');

    // The critical assertion: nothing was written, so the NEXT launch can
    // still enroll this device into either arm.
    expect(mockStorage.has(STORAGE_KEY)).toBe(false);
  });

  it('resolves from a late flags callback when one arrives in time', async () => {
    mockGetFeatureFlag.mockReturnValueOnce(undefined).mockReturnValue('test');
    mockOnFeatureFlags.mockImplementation((cb: any) => {
      setTimeout(() => cb(), 10);
      return () => {};
    });

    await expect(resolvePostingFeeVariant()).resolves.toBe('fee');
  });
});

describe('downstream attribution', () => {
  it('stamps the arm as a person property on first assignment', async () => {
    mockGetFeatureFlag.mockReturnValue('test');
    await resolvePostingFeeVariant();
    expect(mockSetPersonProperties).toHaveBeenCalledWith({ posting_fee_variant: 'fee' });
  });

  it('re-stamps from the persisted arm on a cold start', async () => {
    // Person properties do not survive reset() at sign-out, so a returning
    // user would otherwise lose arm attribution on every downstream event.
    mockStorage.set(STORAGE_KEY, 'fee');
    await resolvePostingFeeVariant();
    expect(mockSetPersonProperties).toHaveBeenCalledWith({ posting_fee_variant: 'fee' });
  });

  it('does not stamp anything when the arm could not be resolved', async () => {
    mockGetFeatureFlag.mockReturnValue(undefined);
    jest.useFakeTimers();
    const pending = resolvePostingFeeVariant();
    await jest.advanceTimersByTimeAsync(500);
    await pending;
    expect(mockSetPersonProperties).not.toHaveBeenCalled();
  });

  it('survives a throwing analytics client — an arm must still resolve', async () => {
    mockGetFeatureFlag.mockReturnValue('test');
    mockSetPersonProperties.mockImplementation(() => {
      throw new Error('posthog exploded');
    });
    await expect(resolvePostingFeeVariant()).resolves.toBe('fee');
  });
});
