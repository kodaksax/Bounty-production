// __tests__/lib/sentry-gate.test.ts
// Tests for lib/utils/sentry-gate.ts isSentryInitSafe()

const gateFor = (os: string, version: unknown): boolean => {
  let result!: boolean;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os, Version: version } }));
    result = require('../../lib/utils/sentry-gate').isSentryInitSafe();
  });
  return result;
};

describe('isSentryInitSafe', () => {
  test('non-iOS platforms always run Sentry', () => {
    expect(gateFor('android', 34)).toBe(true);
  });

  test('iOS below 26 runs Sentry', () => {
    expect(gateFor('ios', '18.5')).toBe(true);
  });

  test('iOS 26+ skips Sentry (native init crashes there)', () => {
    expect(gateFor('ios', '26.3.1')).toBe(false);
  });

  test('an unreadable iOS version is treated as unsafe, not as below 26', () => {
    expect(gateFor('ios', undefined)).toBe(false);
    expect(gateFor('ios', 'unknown')).toBe(false);
  });
});
