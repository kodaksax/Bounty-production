// __tests__/lib/services/app-metrics.test.ts
// Tests for lib/services/app-metrics.ts: the guarded wrapper around expo-observe.

type AppMetricsModule = typeof import('../../../lib/services/app-metrics');

const loadWith = (observeFactory: () => unknown): AppMetricsModule => {
  let mod!: AppMetricsModule;
  jest.isolateModules(() => {
    jest.doMock('expo-observe', observeFactory);
    mod = require('../../../lib/services/app-metrics');
  });
  return mod;
};

const Root = () => null;

describe('app-metrics', () => {
  const g = globalThis as unknown as { __DEV__: boolean };
  const originalDev = g.__DEV__;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    g.__DEV__ = originalDev;
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.dontMock('expo-observe');
  });

  describe('when the native module is missing', () => {
    const missing = () => {
      throw new Error("Cannot find native module 'ExpoAppMetrics'");
    };

    test('markAppInteractive is a no-op and does not throw', () => {
      const { markAppInteractive } = loadWith(missing);
      expect(() => markAppInteractive()).not.toThrow();
    });

    test('wrapWithAppMetrics returns the original component', () => {
      const { wrapWithAppMetrics } = loadWith(missing);
      expect(wrapWithAppMetrics(Root)).toBe(Root);
    });

    test('warns in development instead of throwing', () => {
      g.__DEV__ = true;
      expect(() => loadWith(missing)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ExpoAppMetrics'));
    });
  });

  describe('when expo-observe fails for another reason', () => {
    const broken = () => {
      throw new Error('Unable to resolve module expo-app-metrics');
    };

    test('rethrows in development so the real bug is visible', () => {
      g.__DEV__ = true;
      expect(() => loadWith(broken)).toThrow('Unable to resolve module expo-app-metrics');
    });

    test('logs and degrades to no-ops in production', () => {
      g.__DEV__ = false;
      const { markAppInteractive, wrapWithAppMetrics } = loadWith(broken);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('expo-observe failed to load'),
        expect.any(Error)
      );
      expect(() => markAppInteractive()).not.toThrow();
      expect(wrapWithAppMetrics(Root)).toBe(Root);
    });
  });

  describe('when expo-observe is available', () => {
    test('markAppInteractive delegates to AppMetrics.markInteractive', () => {
      const markInteractive = jest.fn();
      const { markAppInteractive } = loadWith(() => ({
        AppMetrics: { markInteractive },
        AppMetricsRoot: { wrap: jest.fn() },
      }));
      markAppInteractive();
      expect(markInteractive).toHaveBeenCalledTimes(1);
    });

    test('markAppInteractive swallows errors from markInteractive', () => {
      const { markAppInteractive } = loadWith(() => ({
        AppMetrics: {
          markInteractive: () => {
            throw new Error('native failure');
          },
        },
        AppMetricsRoot: { wrap: jest.fn() },
      }));
      expect(() => markAppInteractive()).not.toThrow();
    });

    test('wrapWithAppMetrics delegates to AppMetricsRoot.wrap', () => {
      const Wrapped = () => null;
      const wrap = jest.fn(() => Wrapped);
      const { wrapWithAppMetrics } = loadWith(() => ({
        AppMetrics: { markInteractive: jest.fn() },
        AppMetricsRoot: { wrap },
      }));
      expect(wrapWithAppMetrics(Root)).toBe(Wrapped);
      expect(wrap).toHaveBeenCalledWith(Root);
    });

    test('wrapWithAppMetrics returns the original component when wrap throws', () => {
      const { wrapWithAppMetrics } = loadWith(() => ({
        AppMetrics: { markInteractive: jest.fn() },
        AppMetricsRoot: {
          wrap: () => {
            throw new Error('wrap failed');
          },
        },
      }));
      expect(wrapWithAppMetrics(Root)).toBe(Root);
    });
  });
});
