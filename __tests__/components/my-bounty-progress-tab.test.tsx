/**
 * Tests for the minimized ("stashed") tab of MyBountyProgressCarousel
 * (components/my-bounty-progress-banner.tsx).
 *
 * The grid feed renders it transparent and large so it blends into the green
 * "Find a Bounty" banner yet stays readable, and pushes the banner title down
 * while it shows (onTabVisibleChange). Other layouts keep the small frosted
 * tab.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import type { Bounty } from '../../lib/services/database.types';

let mockStashed: string | null = 'true';
jest.mock('../../lib/storage', () => ({
  storage: {
    getItem: jest.fn(() => Promise.resolve(mockStashed)),
    setItem: jest.fn(() => Promise.resolve()),
  },
}));

import {
  LARGE_TAB_HEIGHT,
  MyBountyProgressCarousel,
  type MyBountyProgressItem,
} from '../../components/my-bounty-progress-banner';

function item(id: number): MyBountyProgressItem {
  return {
    bounty: { id, title: `Bounty ${id}`, created_at: '2026-09-01T00:00:00Z' } as unknown as Bounty,
    stage: 'open',
  };
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flatten));
  return (style as Record<string, unknown>) ?? {};
}

beforeEach(() => {
  mockStashed = 'true';
});

async function renderTab(props: Partial<React.ComponentProps<typeof MyBountyProgressCarousel>> = {}) {
  const utils = render(
    <MyBountyProgressCarousel items={[item(1)]} onPressItem={jest.fn()} {...props} />
  );
  await waitFor(() => expect(utils.getByTestId('feed-my-bounty-progress-tab')).toBeTruthy());
  return utils;
}

describe('stashed tab — grid feed (transparent + large)', () => {
  it('has no background and no blur, so it blends into the banner', async () => {
    const utils = await renderTab({ transparentTab: true, largeTab: true });
    const tab = utils.getByTestId('feed-my-bounty-progress-tab');

    expect(flatten(tab.props.style).backgroundColor).toBe('transparent');
    expect(utils.UNSAFE_queryAllByType('BlurView' as never)).toHaveLength(0);
  });

  it('is drawn at the large size with a readable label', async () => {
    const utils = await renderTab({ transparentTab: true, largeTab: true });
    const tab = utils.getByTestId('feed-my-bounty-progress-tab');

    expect(flatten(tab.props.style).height).toBe(LARGE_TAB_HEIGHT);
    const label = utils.getByText('Your bounty');
    expect(flatten(label.props.style).fontSize).toBeGreaterThanOrEqual(15);
  });

  it('pluralizes the label and shows the count for several bounties', async () => {
    const utils = await renderTab({
      items: [item(1), item(2), item(3)],
      transparentTab: true,
      largeTab: true,
    });
    expect(utils.getByText('Your bounties')).toBeTruthy();
    expect(utils.getByText('(3)')).toBeTruthy();
  });

  it('uses the given content color for its text', async () => {
    const utils = await renderTab({
      transparentTab: true,
      largeTab: true,
      tabContentColor: '#ffffff',
    });
    expect(flatten(utils.getByText('Your bounty').props.style).color).toBe('#ffffff');
  });
});

describe('stashed tab — other layouts (default)', () => {
  it('keeps the small frosted tab with no label', async () => {
    const utils = await renderTab();
    const tab = utils.getByTestId('feed-my-bounty-progress-tab');

    expect(flatten(tab.props.style).backgroundColor).not.toBe('transparent');
    expect(flatten(tab.props.style).height).toBeLessThan(LARGE_TAB_HEIGHT);
    expect(utils.UNSAFE_queryAllByType('BlurView' as never)).toHaveLength(1);
    expect(utils.queryByText(/Your bount/)).toBeNull();
  });
});

describe('onTabVisibleChange', () => {
  it('reports the tab as visible when the cards are stashed', async () => {
    const onTabVisibleChange = jest.fn();
    await renderTab({ onTabVisibleChange });
    expect(onTabVisibleChange).toHaveBeenLastCalledWith(true);
  });

  it('reports no tab when the cards are showing', async () => {
    mockStashed = null;
    const onTabVisibleChange = jest.fn();
    const utils = render(
      <MyBountyProgressCarousel
        items={[item(1)]}
        onPressItem={jest.fn()}
        onTabVisibleChange={onTabVisibleChange}
      />
    );
    await waitFor(() => expect(onTabVisibleChange).toHaveBeenCalled());
    expect(onTabVisibleChange).not.toHaveBeenCalledWith(true);
    expect(utils.queryByTestId('feed-my-bounty-progress-tab')).toBeNull();
  });

  it('reports the tab gone when the carousel unmounts', async () => {
    const onTabVisibleChange = jest.fn();
    const utils = await renderTab({ onTabVisibleChange });
    utils.unmount();
    expect(onTabVisibleChange).toHaveBeenLastCalledWith(false);
  });
});
