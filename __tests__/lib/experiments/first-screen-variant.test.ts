// __tests__/lib/experiments/first-screen-variant.test.ts
// Tests for the 'welcome-page-redesign' arm resolution in
// lib/experiments/first-screen-variant.ts

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@bounty_first_screen_variant_v3';

type FlagValue = string | boolean | undefined;

/**
 * Loads a fresh copy of the module (its resolved-arm cache is module-level)
 * with lib/posthog stubbed out.
 */
function loadModule(opts: {
  flagValue: FlagValue;
  /** Value delivered later via the onFeatureFlags subscription, if any. */
  lateFlagValue?: FlagValue;
}) {
  const getFeatureFlag = jest.fn();
  getFeatureFlag.mockReturnValue(opts.flagValue);

  const unsubscribe = jest.fn();
  const onFeatureFlags = jest.fn((cb: () => void) => {
    if (opts.lateFlagValue !== undefined) {
      // Deliver the flags response asynchronously, as the SDK does.
      setTimeout(() => {
        getFeatureFlag.mockReturnValue(opts.lateFlagValue);
        cb();
      }, 10);
    }
    return unsubscribe;
  });

  let mod!: typeof import('../../../lib/experiments/first-screen-variant');
  jest.isolateModules(() => {
    jest.doMock('../../../lib/posthog', () => ({ getFeatureFlag, onFeatureFlags }));
    mod = require('../../../lib/experiments/first-screen-variant');
  });

  return { mod, getFeatureFlag, onFeatureFlags, unsubscribe };
}

describe('resolveFirstScreenVariant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  test("maps the flag's 'test' variant to poster_first and persists it", async () => {
    const { mod, getFeatureFlag } = loadModule({ flagValue: 'test' });

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('poster_first');
    expect(getFeatureFlag).toHaveBeenCalledWith('welcome-page-redesign');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'poster_first');
  });

  test("maps the flag's 'control' variant to control and persists it", async () => {
    const { mod } = loadModule({ flagValue: 'control' });

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('control');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'control');
  });

  test('treats a device outside the rollout (flag false) as control', async () => {
    const { mod } = loadModule({ flagValue: false });

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('control');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'control');
  });

  test('a persisted arm wins without reading the flag again', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('poster_first');
    const { mod, getFeatureFlag } = loadModule({ flagValue: 'control' });

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('poster_first');
    expect(getFeatureFlag).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('waits for a flags response that lands after the first read', async () => {
    const { mod, unsubscribe } = loadModule({ flagValue: undefined, lateFlagValue: 'test' });

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('poster_first');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'poster_first');
    expect(unsubscribe).toHaveBeenCalled();
  });

  test('falls back to control without persisting when flags never land', async () => {
    const { mod, unsubscribe } = loadModule({ flagValue: undefined });

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('control');
    // Not persisted: the next launch reads the by-then-cached flag and can
    // still enroll this device in the experiment.
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });

  test('resolves from the in-memory cache on subsequent calls', async () => {
    const { mod, getFeatureFlag } = loadModule({ flagValue: 'test' });

    await mod.resolveFirstScreenVariant();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    getFeatureFlag.mockClear();

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('poster_first');
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(getFeatureFlag).not.toHaveBeenCalled();
  });

  test('falls back to a flag read when AsyncStorage throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
    const { mod } = loadModule({ flagValue: 'test' });

    await expect(mod.resolveFirstScreenVariant()).resolves.toBe('poster_first');
  });
});
