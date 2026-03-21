/* eslint-env jest */
// Tests for offline-queue-service behavior: enqueue, flush on reconnect, retry

jest.setTimeout(10000);

let netinfo: any;
let AsyncStorageMock: any;

beforeEach(() => {
  jest.resetModules();
});

test('enqueue while offline then flush on reconnect', async () => {
  let netListener: any = null;

  // Mock NetInfo to allow triggering connectivity changes
  jest.doMock('@react-native-community/netinfo', () => ({
    addEventListener: (cb: any) => {
      netListener = cb;
      // Start offline
      cb({ isConnected: false });
      return () => {};
    },
  }));

  // Mock AsyncStorage with in-memory store
  const store: Record<string, string> = {};
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    getItem: async (k: string) => store[k] ?? null,
    setItem: async (k: string, v: string) => { store[k] = v; },
    removeItem: async (k: string) => { delete store[k]; },
  }));

  // Mock bounty service to capture processing
  const processQueuedBounty = jest.fn(async (b: any) => ({ id: 'created-1', ...b }));
  jest.doMock('lib/services/bounty-service', () => ({
    bountyService: { processQueuedBounty },
  }));

  // Import the offline queue after mocks are set
  const { offlineQueueService } = await import('../offline-queue-service');

  // Enqueue a bounty while offline
  const item = await offlineQueueService.enqueue('bounty', { bounty: { title: 'T' } });
  expect(offlineQueueService.getQueue().some(i => i.id === item.id)).toBe(true);

  // Trigger reconnect
  expect(netListener).toBeTruthy();
  // call reconnect
  await netListener({ isConnected: true });

  // Wait for queue to clear
  await waitFor(() => offlineQueueService.getQueue().length === 0);
  expect(processQueuedBounty).toHaveBeenCalled();
  // Verify the queued bounty payload was passed through intact
  expect(processQueuedBounty).toHaveBeenCalledWith(expect.objectContaining({ title: 'T' }));
});

test('retry increments retryCount and succeeds on retry', async () => {
  let netListener: any = null;

  jest.doMock('@react-native-community/netinfo', () => ({
    addEventListener: (cb: any) => {
      netListener = cb;
      cb({ isConnected: true });
      return () => {};
    },
  }));

  const store: Record<string, string> = {};
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    getItem: async (k: string) => store[k] ?? null,
    setItem: async (k: string, v: string) => { store[k] = v; },
    removeItem: async (k: string) => { delete store[k]; },
  }));

  // First call fails, second call succeeds
  const processQueuedBounty = jest.fn()
    .mockImplementationOnce(async () => { throw new Error('temporary failure'); })
    .mockImplementationOnce(async (b: any) => ({ id: 'created-2', ...b }));

  jest.doMock('lib/services/bounty-service', () => ({
    bountyService: { processQueuedBounty },
  }));

  const { offlineQueueService } = await import('../offline-queue-service');

  const item = await offlineQueueService.enqueue('bounty', { bounty: { title: 'RetryTest' } });

  // Wait until first attempt processed (will fail and remain pending)
  await waitFor(() => offlineQueueService.getQueue().some(i => i.id === item.id && i.retryCount > 0));

  // Retry manually
  await offlineQueueService.retryItem(item.id);

  // Wait for queue to be empty (processed successfully)
  await waitFor(() => offlineQueueService.getQueue().length === 0);
  // Ensure the processing function was invoked twice and received the queued payload
  expect(processQueuedBounty).toHaveBeenCalledTimes(2);
  expect(processQueuedBounty).toHaveBeenCalledWith(expect.objectContaining({ title: 'RetryTest' }));
});

// Helper: wait for condition
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return;
    // small delay
    // eslint-disable-next-line no-await-in-loop
    await new Promise(res => setTimeout(res, 30));
  }
  throw new Error('waitFor timeout');
}
