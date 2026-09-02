/**
 * Tests for the Android background bitmap-cache trimmer.
 *
 * The behaviour that matters for Google Play's bitmap-memory thresholds is
 * specifically the *delayed* trim: clearing immediately on every background
 * transition would thrash the cache on app-switches and photo-picker round
 * trips, so these tests pin both halves — it does fire after the delay, and it
 * does NOT fire if the user comes back first.
 */

const mockAddEventListener = jest.fn();
const mockRemove = jest.fn();
const mockClearMemoryCache = jest.fn().mockResolvedValue(true);

jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
  AppState: {
    addEventListener: (...args: any[]) => mockAddEventListener(...args),
  },
}));

jest.mock('expo-image', () => ({
  Image: { clearMemoryCache: () => mockClearMemoryCache() },
}));

// Imported after the mocks so the module binds to them.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startMemoryPressureWatcher, registerMemoryTrimmer, __testables } =
  require('../services/memory-pressure') as typeof import('../services/memory-pressure');

/** Drives the AppState 'change' handler the module registered. */
function emitAppState(next: string) {
  const handler = mockAddEventListener.mock.calls.at(-1)?.[1];
  handler(next);
}

describe('memory-pressure watcher (Android)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAddEventListener.mockReset();
    mockAddEventListener.mockReturnValue({ remove: mockRemove });
    mockRemove.mockReset();
    mockClearMemoryCache.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('subscribes to AppState changes', () => {
    const stop = startMemoryPressureWatcher();
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    stop();
  });

  it('clears the decoded-bitmap cache once the app stays backgrounded', async () => {
    const stop = startMemoryPressureWatcher();

    emitAppState('background');
    expect(mockClearMemoryCache).not.toHaveBeenCalled();

    jest.advanceTimersByTime(__testables.TRIM_DELAY_MS);
    await Promise.resolve();

    expect(mockClearMemoryCache).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not clear when the user returns before the delay elapses', async () => {
    const stop = startMemoryPressureWatcher();

    emitAppState('background');
    jest.advanceTimersByTime(__testables.TRIM_DELAY_MS - 1);
    emitAppState('active');
    jest.advanceTimersByTime(__testables.TRIM_DELAY_MS * 2);
    await Promise.resolve();

    expect(mockClearMemoryCache).not.toHaveBeenCalled();
    stop();
  });

  it('only schedules one trim for repeated background/inactive events', async () => {
    const stop = startMemoryPressureWatcher();

    emitAppState('inactive');
    emitAppState('background');
    emitAppState('background');

    jest.advanceTimersByTime(__testables.TRIM_DELAY_MS);
    await Promise.resolve();

    expect(mockClearMemoryCache).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs registered trimmers and survives one that throws', async () => {
    const good = jest.fn();
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const unregisterBad = registerMemoryTrimmer('bad', bad);
    const unregisterGood = registerMemoryTrimmer('good', good);

    const stop = startMemoryPressureWatcher();
    emitAppState('background');
    jest.advanceTimersByTime(__testables.TRIM_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();

    unregisterBad();
    unregisterGood();
    stop();
  });

  it('removes its subscription and cancels a pending trim on teardown', async () => {
    const stop = startMemoryPressureWatcher();

    emitAppState('background');
    stop();

    jest.advanceTimersByTime(__testables.TRIM_DELAY_MS * 2);
    await Promise.resolve();

    expect(mockRemove).toHaveBeenCalled();
    expect(mockClearMemoryCache).not.toHaveBeenCalled();
  });
});
