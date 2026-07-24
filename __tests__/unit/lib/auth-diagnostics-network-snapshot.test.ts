/**
 * Regression coverage for the production sign-in hang.
 *
 * `getNetworkSnapshot()` is awaited before every auth stage (and in
 * `emitAuthLoginSuccess`). It calls `NetInfo.fetch()`, whose reachability probe
 * can block on flaky or captive networks. An unbounded call would add its
 * latency directly to sign-in. These tests prove the snapshot is bounded and
 * always resolves quickly to an "unknown" fallback rather than hanging.
 */

jest.mock('../../../lib/posthog', () => ({ capture: jest.fn() }));
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { info: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));

const mockFetch = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: (...args: unknown[]) => mockFetch(...args) },
}));

import { getNetworkSnapshot } from '../../../lib/utils/auth-diagnostics';

describe('getNetworkSnapshot', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('returns the live NetInfo state when the probe resolves quickly', async () => {
    mockFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
    });

    await expect(getNetworkSnapshot()).resolves.toEqual({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
    });
  });

  it('falls back to an unknown snapshot instead of hanging when the probe blocks', async () => {
    jest.useFakeTimers();
    // Reachability probe never resolves.
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const snapshotPromise = getNetworkSnapshot();
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(snapshotPromise).resolves.toEqual({
      isConnected: null,
      isInternetReachable: null,
      type: 'unknown',
    });
  });

  it('falls back to an unknown snapshot when the probe rejects', async () => {
    mockFetch.mockRejectedValue(new Error('netinfo failure'));

    await expect(getNetworkSnapshot()).resolves.toEqual({
      isConnected: null,
      isInternetReachable: null,
      type: 'unknown',
    });
  });
});
