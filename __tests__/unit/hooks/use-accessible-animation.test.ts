/**
 * createSpring — Animated.spring throws when a config mixes bounciness/speed,
 * tension/friction and stiffness/damping/mass. The floating tab bar passes
 * speed/bounciness, so the default tension/friction must not be added then.
 */
import { renderHook } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { useAccessibleAnimation } from '../../../hooks/use-accessible-animation';

// Same check as React Native's SpringAnimation constructor.
function assertSingleSpringFamily(config: Record<string, unknown>) {
  const has = (key: string) => config[key] !== undefined;
  const families = [
    has('bounciness') || has('speed'),
    has('tension') || has('friction'),
    has('stiffness') || has('damping') || has('mass'),
  ].filter(Boolean).length;
  if (families > 1) {
    throw new Error(
      'You can define one of bounciness/speed, tension/friction, or stiffness/damping/mass, but not more than one'
    );
  }
}

const springMock = Animated.spring as unknown as jest.Mock;

describe('useAccessibleAnimation createSpring', () => {
  beforeEach(() => {
    springMock.mockClear();
    springMock.mockImplementation((_value: unknown, config: Record<string, unknown>) => {
      assertSingleSpringFamily(config);
      return { start: jest.fn(), stop: jest.fn() };
    });
  });

  function lastSpringConfig() {
    return springMock.mock.calls[springMock.mock.calls.length - 1][1];
  }

  it('does not throw when the caller passes speed and bounciness', () => {
    const { result } = renderHook(() => useAccessibleAnimation());
    const value = new Animated.Value(0);

    expect(() =>
      result.current.createSpring(value, 100, { speed: 18, bounciness: 6 })
    ).not.toThrow();
    expect(lastSpringConfig()).toEqual({
      toValue: 100,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    });
  });

  it('does not add tension/friction when the caller passes stiffness/damping/mass', () => {
    const { result } = renderHook(() => useAccessibleAnimation());

    expect(() =>
      result.current.createSpring(new Animated.Value(0), 1, { stiffness: 200, damping: 15 })
    ).not.toThrow();
    expect(lastSpringConfig()).not.toHaveProperty('tension');
    expect(lastSpringConfig()).not.toHaveProperty('friction');
  });

  it('uses the default tension/friction when the caller passes no spring config', () => {
    const { result } = renderHook(() => useAccessibleAnimation());

    result.current.createSpring(new Animated.Value(1), 0.96);

    expect(lastSpringConfig()).toMatchObject({ tension: 300, friction: 20 });
  });

  it('lets the caller override tension/friction', () => {
    const { result } = renderHook(() => useAccessibleAnimation());

    result.current.createSpring(new Animated.Value(0), 1.1, { tension: 40, friction: 3 });

    expect(lastSpringConfig()).toMatchObject({ tension: 40, friction: 3 });
  });
});
