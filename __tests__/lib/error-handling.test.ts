// __tests__/lib/error-handling.test.ts
// Tests for lib/error-handling.ts initGlobalErrorHandlers()

describe('initGlobalErrorHandlers', () => {
  let current: ((error: any, isFatal?: boolean) => void) | undefined;
  const previousHandler = jest.fn();
  const savedErrorUtils = (global as any).ErrorUtils;

  beforeEach(() => {
    previousHandler.mockReset();
    current = previousHandler;
    (global as any).ErrorUtils = {
      getGlobalHandler: () => current,
      setGlobalHandler: jest.fn((handler: any) => {
        current = handler;
      }),
    };
  });

  afterAll(() => {
    (global as any).ErrorUtils = savedErrorUtils;
  });

  const load = () => {
    let init!: () => void;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Alert: { alert: jest.fn() } }));
      init = require('../../lib/error-handling').initGlobalErrorHandlers;
    });
    return init;
  };

  test('forwards every error to the handler it replaced, as non-fatal', () => {
    const init = load();
    init();
    const error = new Error('boom');
    current?.(error, true);
    // non-fatal so React Native's default handler never crashes the app —
    // this handler shows an alert for fatal errors instead
    expect(previousHandler).toHaveBeenCalledWith(error, false);
  });

  test('a second call is a no-op and keeps a handler chained on top of it', () => {
    const init = load();
    init();
    const chainedOnTop = jest.fn();
    current = chainedOnTop; // e.g. Sentry installing after us
    init();
    expect((global as any).ErrorUtils.setGlobalHandler).toHaveBeenCalledTimes(1);
    expect(current).toBe(chainedOnTop);
  });
});
