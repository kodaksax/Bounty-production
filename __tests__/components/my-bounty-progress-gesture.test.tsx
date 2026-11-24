import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import type { Bounty } from '../../lib/services/database.types';
import {
  MyBountyProgressCarousel,
  type MyBountyProgressItem,
} from '../../components/my-bounty-progress-banner';

let mockSavedState: string | null = null;

jest.mock('../../lib/storage', () => ({
  storage: {
    getItem: jest.fn(() => Promise.resolve(mockSavedState)),
    setItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../components/ui/tab-pager', () => {
  const gesture = { name: 'tab-pager' };
  return {
    useTabPager: () => ({ gesture }),
    __tabPagerGesture: gesture,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const RN = jest.requireMock('react-native') as any;
  const gestures: any[] = [];
  const createGesture = (kind: string) => {
    const gesture: any = { kind, blockedExternal: [] };
    for (const method of ['activeOffsetY', 'failOffsetX']) {
      gesture[method] = (...values: number[]) => {
        gesture[method === 'activeOffsetY' ? 'activationRange' : 'failureRange'] =
          values.length === 1 ? values[0] : values;
        return gesture;
      };
    }
    for (const method of ['onUpdate', 'onEnd', 'onFinalize']) {
      gesture[method] = (callback: (...args: any[]) => void) => {
        gesture[method] = callback;
        return gesture;
      };
    }
    gesture.blocksExternalGesture = (...external: unknown[]) => {
      gesture.blockedExternal = external;
      return gesture;
    };
    gestures.push(gesture);
    return gesture;
  };
  return {
    __esModule: true,
    ScrollView: RN.ScrollView,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: {
      Pan: () => createGesture('Pan'),
      Native: () => createGesture('Native'),
    },
    __gestures: gestures,
  };
});

const tabPagerMock = jest.requireMock('../../components/ui/tab-pager') as {
  __tabPagerGesture: unknown;
};

jest.mock('react-native-reanimated', () => {
  const RN = jest.requireMock('react-native') as any;
  const sharedValues: { value: number }[] = [];
  const timingTargets: number[] = [];
  const withTiming = (value: number, _config: unknown, callback?: (finished: boolean) => void) => {
    timingTargets.push(value);
    callback?.(true);
    return value;
  };
  const identity = (value: number) => value;
  return {
    __esModule: true,
    default: { View: RN.View, ScrollView: RN.ScrollView },
    Easing: { out: (easing: unknown) => easing, cubic: identity },
    useSharedValue: (value: number) => {
      const sharedValue = { value };
      sharedValues.push(sharedValue);
      return sharedValue;
    },
    useAnimatedStyle: () => ({}),
    withTiming,
    runOnJS: (callback: (...args: any[]) => void) => callback,
    __sharedValues: sharedValues,
    __timingTargets: timingTargets,
  };
});

const gestureMock = jest.requireMock('react-native-gesture-handler') as {
  __gestures: {
    kind: string;
    activationRange?: number[];
    failureRange?: number[];
    blockedExternal: unknown[];
    onFinalize?: (event: unknown, success: boolean) => void;
  }[];
};
const reanimatedMock = jest.requireMock('react-native-reanimated') as {
  __sharedValues: { value: number }[];
  __timingTargets: number[];
};

function item(): MyBountyProgressItem {
  return {
    bounty: { id: 1, title: 'Bounty', created_at: '2026-09-01T00:00:00Z' } as unknown as Bounty,
    stage: 'open',
  };
}

async function renderCarousel() {
  const utils = render(<MyBountyProgressCarousel items={[item()]} onPressItem={jest.fn()} />);
  await waitFor(() =>
    expect(gestureMock.__gestures.some(gesture => gesture.kind === 'Pan')).toBe(true)
  );
  return utils;
}

beforeEach(() => {
  mockSavedState = null;
  gestureMock.__gestures.length = 0;
  reanimatedMock.__sharedValues.length = 0;
  reanimatedMock.__timingTargets.length = 0;
});

it('activates on vertical travel, fails on sideways drift, and blocks both horizontal pagers', async () => {
  await renderCarousel();

  const cardsPan = gestureMock.__gestures.find(gesture => gesture.kind === 'Pan');
  const cardsScroll = gestureMock.__gestures.find(gesture => gesture.kind === 'Native');

  expect(cardsPan?.activationRange).toEqual([-10, 10]);
  expect(cardsPan?.failureRange).toEqual([-14, 14]);
  expect(cardsPan?.blockedExternal).toEqual([tabPagerMock.__tabPagerGesture, cardsScroll]);
});

it('animates visible cards home when an active pan is canceled', async () => {
  await renderCarousel();
  const cardsPan = gestureMock.__gestures.find(gesture => gesture.kind === 'Pan');

  cardsPan?.onFinalize?.({}, false);

  expect(reanimatedMock.__timingTargets).toEqual([0]);
  expect(reanimatedMock.__sharedValues[0].value).toBe(0);
});

it('returns a canceled stashed-tab pan to the hidden position', async () => {
  mockSavedState = 'true';
  const utils = render(<MyBountyProgressCarousel items={[item()]} onPressItem={jest.fn()} />);
  await waitFor(() => expect(utils.getByTestId('feed-my-bounty-progress-tab')).toBeTruthy());

  const tabPan = gestureMock.__gestures.find(
    gesture => gesture.kind === 'Pan' && gesture.activationRange?.[1] === 6
  );
  expect(tabPan?.failureRange).toEqual([-14, 14]);
  expect(tabPan?.blockedExternal).toEqual([tabPagerMock.__tabPagerGesture]);

  tabPan?.onFinalize?.({}, false);

  expect(reanimatedMock.__timingTargets).toEqual([-24]);
});
