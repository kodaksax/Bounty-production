/**
 * HomePostCard (components/home-post-card.tsx): its rows, its analytics, and
 * the full-width tablet layout.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

const mockTrack = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrack(...args) },
}));

import { HomePostCard, type HomePostCardProps } from '../../components/home-post-card';

// The jest setup mocks useWindowDimensions with a jest.fn.
const setWindowWidth = (width: number) =>
  (require('react-native').useWindowDimensions as jest.Mock).mockImplementation(() => ({
    width,
    height: 844,
    scale: 3,
    fontScale: 1,
  }));

const baseProps = {
  impressionReady: true,
  primaryRole: 'poster' as const,
  hasPosted: true,
  layout: 'card',
};

const renderCard = (props: Partial<HomePostCardProps> = {}) => {
  const handlers = { onPostNew: jest.fn(), onSeeAllPosts: jest.fn() };
  const utils = render(<HomePostCard {...handlers} {...baseProps} {...props} />);
  return { ...utils, ...handlers };
};

// The jest setup stubs StyleSheet.flatten, so flatten style arrays here.
const flatten = (style: any): Record<string, any> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};
const cardStyle = () => flatten(screen.getByTestId('home-post-card').props.style);

describe('HomePostCard', () => {
  beforeEach(() => {
    mockTrack.mockClear();
    setWindowWidth(390);
  });

  it("leads with a 'Post a job' button and links to the poster's posts", () => {
    const { onPostNew, onSeeAllPosts } = renderCard();
    fireEvent.press(screen.getByText('Post a job'));
    fireEvent.press(screen.getByText('See all my posts'));
    expect(onPostNew).toHaveBeenCalledTimes(1);
    expect(onSeeAllPosts).toHaveBeenCalledTimes(1);
  });

  it('has no "Post again" row without a Post-again target', () => {
    renderCard({ postAgain: null });
    expect(screen.queryByTestId('home-post-card-post-again')).toBeNull();
  });

  it('names the bounty in the "Post again" row, with a fallback for a blank title', () => {
    const onPress = jest.fn();
    const { rerender } = renderCard({
      postAgain: { bountyId: 'b-1', title: 'Walk my dog', onPress },
    });
    expect(screen.getByLabelText('Post again: Walk my dog')).toBeTruthy();
    fireEvent.press(screen.getByTestId('home-post-card-post-again'));
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender(
      <HomePostCard
        onPostNew={jest.fn()}
        onSeeAllPosts={jest.fn()}
        {...baseProps}
        postAgain={{ bountyId: 'b-1', title: '', onPress }}
      />
    );
    expect(screen.getByLabelText('Post again: your last job')).toBeTruthy();
  });

  it('fires home_post_card_shown once, and only once ready', () => {
    const props = {
      onPostNew: jest.fn(),
      onSeeAllPosts: jest.fn(),
      primaryRole: 'poster' as const,
      hasPosted: false,
      layout: 'compact',
    };
    const { rerender } = render(<HomePostCard {...props} impressionReady={false} />);
    expect(mockTrack).not.toHaveBeenCalled();

    rerender(<HomePostCard {...props} impressionReady />);
    rerender(<HomePostCard {...props} impressionReady={false} />);
    rerender(<HomePostCard {...props} impressionReady />);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('home_post_card_shown', {
      surface: 'home_feed',
      role: 'poster',
      primary_role: 'poster',
      has_posted: false,
      post_again_available: false,
      layout: 'compact',
    });
  });

  it.each([
    ['post_new', 'home-post-card-post-new', undefined],
    ['post_again', 'home-post-card-post-again', 'b-9'],
    ['see_all_posts', 'home-post-card-see-all', undefined],
  ])('fires home_post_card_tapped with action %s', (action, testID, bountyId) => {
    renderCard({
      impressionReady: false,
      postAgain: { bountyId: 'b-9', title: 'Paint the fence', onPress: jest.fn() },
    });
    fireEvent.press(screen.getByTestId(testID));
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(
      'home_post_card_tapped',
      expect.objectContaining({
        action,
        surface: 'home_feed',
        post_again_available: true,
        ...(bountyId ? { bounty_id: bountyId } : {}),
      })
    );
    if (!bountyId) {
      expect(mockTrack.mock.calls[0][1]).not.toHaveProperty('bounty_id');
    }
  });

  it('stacks on a phone and goes side by side, full width, on a tablet', () => {
    const { rerender } = renderCard();
    const phone = cardStyle();
    expect(phone.flexDirection).toBeUndefined();
    expect(phone.marginHorizontal).toBe(16);
    expect(phone.maxWidth).toBeUndefined();

    setWindowWidth(1024);
    rerender(<HomePostCard onPostNew={jest.fn()} onSeeAllPosts={jest.fn()} {...baseProps} />);
    const tablet = cardStyle();
    expect(tablet.flexDirection).toBe('row');
    expect(tablet.marginHorizontal).toBe(16);
    expect(tablet.maxWidth).toBeUndefined();
    const button = flatten(screen.getByTestId('home-post-card-post-new').props.style);
    expect(button.flex).toBe(1);
  });

  it('drops its own gutter when the host already has one (grid header)', () => {
    renderCard({ inset: false });
    expect(cardStyle().marginHorizontal).toBeUndefined();
  });
});
