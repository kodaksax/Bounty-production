/**
 * @jest-environment jsdom
 */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ProfileImageViewer } from '../../components/ProfileImageViewer';

// The global react-native mock in jest.setup.js doesn't include Pressable,
// BackHandler, or useWindowDimensions (nothing else in the suite needs
// them yet). Extend it locally for this component.
jest.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: jest.fn().mockResolvedValue(false),
    addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    announceForAccessibility: jest.fn(),
  },
  Platform: { OS: 'ios', select: (obj: any) => obj.ios || obj.default },
  StyleSheet: {
    create: (styles: any) => styles,
    flatten: (style: any) => style,
    absoluteFill: {},
    absoluteFillObject: {},
  },
  BackHandler: {
    addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  },
  useWindowDimensions: jest.fn(() => ({ width: 375, height: 812, scale: 2, fontScale: 1 })),
  View: 'View',
  Text: 'Text',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: 'Animated.View',
    createAnimatedComponent: (component: any) => component,
  },
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: (fn: () => any) => {
    try {
      return fn();
    } catch {
      return {};
    }
  },
  withSpring: (value: number) => value,
  withTiming: (value: number) => value,
  runOnJS:
    (fn: (...args: any[]) => void) =>
    (...args: any[]) =>
      fn(...args),
  interpolate: () => 0,
  Extrapolation: { CLAMP: 'clamp' },
}));

jest.mock('react-native-gesture-handler', () => {
  const chainable = (): any => {
    const proxy: any = new Proxy(
      {},
      {
        get: () => () => proxy,
      }
    );
    return proxy;
  };
  return {
    Gesture: {
      Pinch: () => chainable(),
      Pan: () => chainable(),
      Tap: () => chainable(),
      Simultaneous: () => chainable(),
      Exclusive: () => chainable(),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('lib/components/OptimizedImage', () => {
  const React = require('react');
  return {
    OptimizedImage: (props: any) =>
      React.createElement('OptimizedImage', {
        testID: 'profile-photo-image',
        onLoad: props.onLoad,
        onError: props.onError,
        onLoadStart: props.onLoadStart,
        accessibilityLabel: props.alt,
      }),
  };
});

describe('ProfileImageViewer', () => {
  it('renders nothing when not visible', () => {
    const { toJSON } = render(
      <ProfileImageViewer visible={false} imageUrl={null} onRequestClose={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when visible but there is no image url', () => {
    const { toJSON } = render(
      <ProfileImageViewer visible imageUrl={null} onRequestClose={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders the photo and a close button once visible with an image', () => {
    const { getByLabelText } = render(
      <ProfileImageViewer
        visible
        imageUrl="https://example.com/avatar.jpg"
        altText="Jane Doe"
        onRequestClose={jest.fn()}
      />
    );
    expect(getByLabelText('Jane Doe')).toBeTruthy();
    expect(getByLabelText('Close photo viewer')).toBeTruthy();
  });

  it('calls onRequestClose when the close button is pressed', () => {
    const onRequestClose = jest.fn();
    const { getByLabelText } = render(
      <ProfileImageViewer
        visible
        imageUrl="https://example.com/avatar.jpg"
        onRequestClose={onRequestClose}
      />
    );
    fireEvent.press(getByLabelText('Close photo viewer'));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('shows a broken-image fallback when the photo fails to load', () => {
    const { getByLabelText, getByText } = render(
      <ProfileImageViewer
        visible
        imageUrl="https://example.com/avatar.jpg"
        altText="Jane Doe"
        onRequestClose={jest.fn()}
      />
    );
    fireEvent(getByLabelText('Jane Doe'), 'onError');
    expect(getByText("Couldn't load this photo")).toBeTruthy();
  });
});
