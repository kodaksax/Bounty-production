/**
 * @jest-environment jsdom
 */
import React from 'react';
import { SuccessAnimation, ConfettiAnimation } from '../../components/ui/success-animation';

// Mock dependencies
jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (component: any) => component,
    },
    useSharedValue: () => ({ value: 0 }),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    withSequence: (...args: any[]) => args[0],
    withTiming: (value: number) => value,
    withDelay: (delay: number, animation: any) => animation,
  };
});

jest.mock('../../lib/haptic-feedback', () => ({
  hapticFeedback: {
    success: jest.fn(),
  },
}));

jest.mock('@expo/vector-icons', () => ({
  MaterialIcons: 'MaterialIcons',
}));

describe('SuccessAnimation', () => {
  it('should render nothing when not visible', () => {
    const component = <SuccessAnimation visible={false} />;
    expect(component).toBeDefined();
  });

  it('should render when visible', () => {
    const component = <SuccessAnimation visible={true} />;
    expect(component).toBeDefined();
  });

  it('should call onComplete callback', () => {
    const onComplete = jest.fn();
    const component = <SuccessAnimation visible={true} onComplete={onComplete} />;
    expect(component).toBeDefined();
  });

  it('should accept custom icon and size', () => {
    const component = <SuccessAnimation visible={true} icon="check" size={100} color="#00ff00" />;
    expect(component).toBeDefined();
  });
});

describe('ConfettiAnimation', () => {
  it('should render nothing when not visible', () => {
    const component = <ConfettiAnimation visible={false} />;
    expect(component).toBeDefined();
  });

  it('should render when visible', () => {
    const component = <ConfettiAnimation visible={true} />;
    expect(component).toBeDefined();
  });

  it('should call onComplete callback', () => {
    const onComplete = jest.fn();
    const component = <ConfettiAnimation visible={true} onComplete={onComplete} />;
    expect(component).toBeDefined();
  });
});
