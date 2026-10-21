/**
 * components/ui/skeleton — every animated skeleton on screen shares one
 * clock, and a static one (shimmer={false}) never starts it.
 */
import { render } from '@testing-library/react-native';
import React from 'react';
import { Animated } from 'react-native';

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

// eslint-disable-next-line import/first
import { Skeleton } from '../../components/ui/skeleton';

const loopMock = Animated.loop as unknown as jest.Mock;

describe('Skeleton shared clock', () => {
  beforeEach(() => loopMock.mockClear());

  it('runs a single loop however many skeletons are shimmering', () => {
    const { unmount } = render(
      <>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </>
    );
    expect(loopMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('stops the loop with the last skeleton and starts it again for the next', () => {
    const first = render(<Skeleton />);
    const loop = loopMock.mock.results[0].value;
    first.unmount();
    expect(loop.stop).toHaveBeenCalled();

    const second = render(<Skeleton />);
    expect(loopMock).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it('starts no loop for a static skeleton', () => {
    const { unmount } = render(<Skeleton shimmer={false} />);
    expect(loopMock).not.toHaveBeenCalled();
    unmount();
  });
});
