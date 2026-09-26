import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { PostCelebration } from '../../app/screens/CreateBounty/quick/PostCelebration';

jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({
    theme: {
      background: '#fff',
      text: '#111',
      textSecondary: '#555',
      textDisabled: '#999',
      primary: '#059669',
      primaryLight: '#047857',
    },
  }),
}));

describe('PostCelebration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    // The global Animated mock never completes; the fade-out's completion is
    // what hands off to the next step, so let timings finish immediately.
    (Animated.timing as jest.Mock).mockImplementation(() => ({
      start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }),
      stop: jest.fn(),
    }));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the congratulations and fades into the next step on its own', async () => {
    const onDone = jest.fn();
    const { getByTestId } = render(<PostCelebration onDone={onDone} />);
    // The whole screen is one pressable carrying the message as its label.
    const label = getByTestId('post-celebration').props.accessibilityLabel;
    expect(label).toContain('Your bounty is posted!');
    expect(label).toContain("When someone steps up to help, we'll let you know.");

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('can be tapped away early, and only finishes once', async () => {
    const onDone = jest.fn();
    const { getByTestId } = render(<PostCelebration onDone={onDone} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(getByTestId('post-celebration'));
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
