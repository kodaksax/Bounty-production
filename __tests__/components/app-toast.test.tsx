import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/use-accessible-animation', () => ({
  useAccessibleAnimation: () => ({ prefersReducedMotion: true }),
}));
jest.mock('../../lib/haptic-feedback', () => ({
  hapticFeedback: { success: jest.fn(), error: jest.fn() },
}));

import { AppToastHost } from '../../components/ui/app-toast';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { showToast } from '../../lib/toast';

describe('AppToastHost', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // The global react-native mock never finishes an animation.
    (Animated as any).timing = jest.fn(() => ({
      start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }),
    }));
    (AccessibilityInfo as any).announceForAccessibility = jest.fn();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows nothing until a toast is raised', () => {
    const { toJSON } = render(<AppToastHost />);
    expect(toJSON()).toBeNull();
  });

  it('shows the message, announces it, and confirms with a haptic', () => {
    render(<AppToastHost />);
    act(() => showToast({ message: 'Evidence added' }));
    expect(screen.getByText('Evidence added')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Evidence added');
    expect(hapticFeedback.success).toHaveBeenCalledTimes(1);
  });

  it('uses the error haptic for failures', () => {
    render(<AppToastHost />);
    act(() => showToast({ message: 'Upload failed', tone: 'error' }));
    expect(hapticFeedback.error).toHaveBeenCalledTimes(1);
  });

  it('delivers a toast raised before the host mounted', () => {
    showToast({ message: 'Saved before mount' });
    render(<AppToastHost />);
    expect(screen.getByText('Saved before mount')).toBeTruthy();
  });

  it('removes itself after its reading time', () => {
    render(<AppToastHost />);
    act(() => showToast({ message: 'Copied', duration: 2000 }));
    expect(screen.getByText('Copied')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(2000 + 1000);
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('dismisses on tap', () => {
    render(<AppToastHost />);
    act(() => showToast({ message: 'Tap me', duration: 60000 }));
    fireEvent.press(screen.getByText('Tap me'));
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Tap me')).toBeNull();
  });
});
